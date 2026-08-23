import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'

/**
 * Ce qu'un visiteur laisse derrière lui en ouvrant sa session.
 *
 * Favoris, panier, commandes payées sans compte et offres déposées sans compte
 * appartiennent au JETON de session boutique. Ce jeton est renouvelé à chaque
 * ouverture de session — sur un poste partagé, la personne suivante ne doit pas
 * hériter de ce que la précédente avait mis de côté. Tout ce qui n'a pas
 * basculé AVANT ce renouvellement est perdu définitivement.
 *
 * Deux cas étaient déjà perdus :
 *
 *  - `mergeGuestCart` existait, testée, et n'était appelée par aucun code. Le
 *    panier d'un visiteur ne survivait pas à sa connexion ;
 *  - les offres ne basculaient nulle part. Une visiteuse dont l'offre venait
 *    d'être acceptée, à qui un e-mail promettait ce prix pendant vingt-quatre
 *    heures, ouvrait un compte pour payer — et se voyait facturer le prix
 *    affiché, sans message ni erreur.
 */

const SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac'
process.env.AUTH_SECRET = SECRET

/** Boîte à cookies en mémoire, à la place de celle de la requête. */
const jar = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string) => {
      jar.set(name, value)
    },
    delete: (name: string) => {
      jar.delete(name)
    },
  }),
}))

const { prisma } = await import('@/lib/db/client')
const { adoptGuestSession } = await import('@/lib/shop/handover')
const { shopSessionCookieName } = await import('@/lib/shop/session-token')
const { __resetServerSecretForTests } = await import('@/lib/security/secret')

const PREFIX = 'HANDOVER-'
const GUEST_EMAIL = 'visiteuse@reprise.test'

/** Un jeton authentique, frappé comme le serveur le ferait. */
function mintToken(): string {
  const payload = randomBytes(24).toString('base64url')
  const signature = createHmac('sha256', SECRET)
    .update(`shop-session ${payload}`)
    .digest('base64url')
    .slice(0, 22)
  return `${payload}.${signature}`
}

async function cleanup(): Promise<void> {
  await prisma.offer.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } })
  // Les lignes suivent leur panier (cascade), et les paniers se retrouvent par
  // leurs pièces ou par leur compte — jamais par « tout jeton non nul », qui
  // emporterait les paniers des autres fichiers de test.
  await prisma.cart.deleteMany({
    where: {
      OR: [
        { user: { email: { endsWith: '@reprise.test' } } },
        { items: { some: { article: { sku: { startsWith: PREFIX } } } } },
      ],
    },
  })
  await prisma.guestFavorite.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@reprise.test' } } })
}

beforeEach(async () => {
  jar.clear()
  __resetServerSecretForTests()
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(suffix: string): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `reprise-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 3200,
      costCents: 900,
      floorPriceCents: 1800,
      weightGrams: 500,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })
  return article.id
}

async function makeUser(email: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email, role: 'CUSTOMER' },
    select: { id: true },
  })
  return user.id
}

async function makeGuestOrder(
  suffix: string,
  lockOwnerId: string,
  email: string,
  userId: string | null = null,
): Promise<void> {
  await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      userId,
      lockOwnerId,
      email,
      locale: 'fr',
      status: 'PAID',
      paidAt: new Date(),
      subtotalCents: 3200,
      shippingCents: 490,
      totalCents: 3690,
      shippingAddress: { city: 'Lille', line1: '12 rue du Registre' },
      billingAddress: { city: 'Lille' },
      shippingCarrierCode: 'COLISSIMO',
      shippingServiceCode: 'DOMICILE',
    },
  })
}

describe('panier du visiteur', () => {
  it('survit à la connexion', async () => {
    // Le cas oublié : `mergeGuestCart` n'était appelée nulle part. Le panier
    // devenait inatteignable dès que le jeton était renouvelé.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('panier')
    const cart = await prisma.cart.create({
      data: { sessionToken: token, items: { create: { articleId, unitPriceCents: 3200, priceSource: 'LIST' } } },
      select: { id: true },
    })

    const userId = await makeUser('acheteuse@reprise.test')
    const report = await adoptGuestSession(userId, 'acheteuse@reprise.test')

    expect(report.cartLines).toBe(1)

    const kept = await prisma.cart.findFirst({
      where: { userId },
      select: { id: true, items: { select: { articleId: true } } },
    })
    expect(kept?.items.map((item) => item.articleId)).toEqual([articleId])

    // Et le panier de visiteur ne subsiste pas en double.
    const orphan = await prisma.cart.findUnique({
      where: { id: cart.id },
      select: { userId: true },
    })
    expect(orphan?.userId ?? null).toBe(userId)
  })

  it('emporte aussi les favoris', async () => {
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('favori')
    await prisma.guestFavorite.create({ data: { sessionToken: token, articleId } })

    const userId = await makeUser('favorite@reprise.test')
    const report = await adoptGuestSession(userId, 'favorite@reprise.test')

    expect(report.favorites).toBe(1)
    expect(
      await prisma.favorite.count({ where: { userId, articleId } }),
    ).toBe(1)
  })
})

describe('commandes payées sans compte', () => {
  it('rejoignent le compte quand le navigateur ET l’adresse concordent', async () => {
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    await makeGuestOrder('mienne', token, GUEST_EMAIL)

    const userId = await makeUser(GUEST_EMAIL)
    const report = await adoptGuestSession(userId, GUEST_EMAIL)

    expect(report.orders).toBe(1)

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: `${PREFIX}mienne` },
      select: { userId: true, lockOwnerId: true },
    })
    expect(order.userId).toBe(userId)

    // Le propriétaire du VERROU n'est pas touché : `Article.reservedById`
    // porte la même valeur, et les réécrire les désynchroniserait.
    expect(order.lockOwnerId).toBe(token)
  })

  it('ne suit pas une adresse différente, même depuis le même navigateur', async () => {
    // Poste partagé : quelqu'un achète sans compte, laisse la place, la
    // personne suivante se connecte. Son adresse postale ne doit pas atterrir
    // dans le compte de quelqu'un d'autre.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    await makeGuestOrder('autrui', token, 'quelquun-dautre@reprise.test')

    const userId = await makeUser('suivante@reprise.test')
    const report = await adoptGuestSession(userId, 'suivante@reprise.test')

    expect(report.orders).toBe(0)

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: `${PREFIX}autrui` },
      select: { userId: true },
    })
    expect(order.userId).toBeNull()
  })

  it('ignore la casse de l’adresse', async () => {
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    await makeGuestOrder('casse', token, 'Visiteuse@Reprise.test')

    const userId = await makeUser('visiteuse2@reprise.test')
    const report = await adoptGuestSession(userId, 'visiteuse@reprise.TEST')

    expect(report.orders).toBe(1)
  })

  it('ne vole jamais une commande déjà rattachée à un compte', async () => {
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const ownerId = await makeUser('proprietaire@reprise.test')
    await makeGuestOrder('deja', token, 'proprietaire@reprise.test', ownerId)

    // Même jeton, même adresse — et pourtant la commande appartient déjà.
    const intruderId = await makeUser('intruse@reprise.test')
    const report = await adoptGuestSession(intruderId, 'proprietaire@reprise.test')

    expect(report.orders).toBe(0)
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: `${PREFIX}deja` },
      select: { userId: true },
    })
    expect(order.userId).toBe(ownerId)
  })
})

describe('offres déposées sans compte', () => {
  const HOUR = 60 * 60 * 1000

  /** Une offre acceptée, encore payable, déposée sans compte. */
  async function makeGuestOffer(
    articleId: string,
    sessionToken: string,
    email: string,
    amountCents = 2400,
  ): Promise<string> {
    const offer = await prisma.offer.create({
      data: {
        articleId,
        guestSessionToken: sessionToken,
        guestEmail: email,
        amountCents,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 48 * HOUR),
        priceValidUntil: new Date(Date.now() + 24 * HOUR),
        respondedAt: new Date(),
      },
      select: { id: true },
    })
    return offer.id
  }

  it('un prix négocié survit à la connexion', async () => {
    // LE défaut que cette reprise éteint. Sans elle, le panier cherche les
    // offres du COMPTE dès la session ouverte, n'en trouve aucune, et facture
    // le prix affiché — après un e-mail qui promettait l'autre, par écrit.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('negociee')
    await makeGuestOffer(articleId, token, GUEST_EMAIL, 2400)

    const userId = await makeUser(GUEST_EMAIL)
    const report = await adoptGuestSession(userId, GUEST_EMAIL)

    expect(report.offers).toBe(1)

    const { readNegotiatedPrices } = await import('@/lib/shop/negotiated-price')
    const found = await readNegotiatedPrices(
      prisma,
      // L'identité d'après-connexion : le compte, et un jeton tout neuf.
      { userId, sessionToken: 'jeton-renouvele', lockOwnerId: 'jeton-renouvele' },
      [articleId],
      new Date(),
    )

    expect(found.get(articleId)?.amountCents).toBe(2400)
  })

  it('efface les traces d’invité une fois rattachée', async () => {
    // L'adresse e-mail et le jeton ne servent plus à rien : la portée passe
    // par le compte et la réponse part vers l'adresse du compte. Les garder
    // laisserait une donnée personnelle recopiée hors du compte, sans usage.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('traces')
    const offerId = await makeGuestOffer(articleId, token, GUEST_EMAIL)

    const userId = await makeUser(GUEST_EMAIL)
    await adoptGuestSession(userId, GUEST_EMAIL)

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { userId: true, guestEmail: true, guestSessionToken: true },
    })
    expect(offer).toEqual({
      userId,
      guestEmail: null,
      guestSessionToken: null,
    })
  })

  it('ne suit pas une adresse différente, même depuis le même navigateur', async () => {
    // Poste partagé : la personne précédente a négocié, puis laissé la place.
    // Ses négociations ne doivent pas atterrir dans le compte de la suivante —
    // et le prix qu'elle a obtenu ne doit pas devenir payable par quelqu'un
    // d'autre.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('autrui-offre')
    const offerId = await makeGuestOffer(
      articleId,
      token,
      'quelquun-dautre@reprise.test',
    )

    const userId = await makeUser('suivante2@reprise.test')
    const report = await adoptGuestSession(userId, 'suivante2@reprise.test')

    expect(report.offers).toBe(0)
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { userId: true },
    })
    expect(offer.userId).toBeNull()
  })

  it('ne suit pas un autre navigateur, même à la bonne adresse', async () => {
    // L'inscription par mot de passe ne vérifie pas l'adresse : sans la
    // condition du jeton, il suffirait de créer un compte au nom de quelqu'un
    // pour hériter de ses négociations.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('ailleurs')
    const offerId = await makeGuestOffer(articleId, mintToken(), GUEST_EMAIL)

    const userId = await makeUser(GUEST_EMAIL)
    const report = await adoptGuestSession(userId, GUEST_EMAIL)

    expect(report.offers).toBe(0)
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { userId: true },
    })
    expect(offer.userId).toBeNull()
  })

  it('ignore la casse de l’adresse', async () => {
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('casse-offre')
    await makeGuestOffer(articleId, token, 'Visiteuse@Reprise.test')

    const userId = await makeUser('visiteuse3@reprise.test')
    const report = await adoptGuestSession(userId, 'visiteuse@reprise.TEST')

    expect(report.offers).toBe(1)
  })

  it('ne vole jamais une offre déjà rattachée à un compte', async () => {
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const ownerId = await makeUser('negociante@reprise.test')
    const articleId = await makeArticle('deja-offre')
    const offer = await prisma.offer.create({
      data: {
        articleId,
        userId: ownerId,
        // Un reliquat de son passage en visiteuse : le rattachement doit
        // s'arrêter à `userId`, qui n'est plus nul.
        guestSessionToken: token,
        guestEmail: 'negociante@reprise.test',
        amountCents: 2400,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 48 * HOUR),
      },
      select: { id: true },
    })

    const intruderId = await makeUser('intruse2@reprise.test')
    const report = await adoptGuestSession(intruderId, 'negociante@reprise.test')

    expect(report.offers).toBe(0)
    const after = await prisma.offer.findUniqueOrThrow({
      where: { id: offer.id },
      select: { userId: true },
    })
    expect(after.userId).toBe(ownerId)
  })
})

describe('renouvellement du jeton', () => {
  it('arrive APRÈS la reprise, jamais avant', async () => {
    // Toute la difficulté tient dans cet ordre : la reprise lit l'ancien
    // jeton. Inverser les deux ne casse rien de visible — la connexion
    // réussit, la page s'affiche — le panier a simplement disparu.
    const token = mintToken()
    jar.set(shopSessionCookieName(), token)

    const articleId = await makeArticle('ordre')
    await prisma.cart.create({
      data: { sessionToken: token, items: { create: { articleId, unitPriceCents: 3200, priceSource: 'LIST' } } },
    })
    await makeGuestOrder('ordre', token, GUEST_EMAIL)

    const userId = await makeUser(GUEST_EMAIL)
    const report = await adoptGuestSession(userId, GUEST_EMAIL)

    // La reprise a bien eu lieu…
    expect(report.cartLines).toBe(1)
    expect(report.orders).toBe(1)

    // … et le jeton a bien changé.
    const after = jar.get(shopSessionCookieName())
    expect(after).toBeDefined()
    expect(after).not.toBe(token)
  })

  it('pose un jeton neuf même sans rien à reprendre', async () => {
    const userId = await makeUser('neuve@reprise.test')
    const report = await adoptGuestSession(userId, 'neuve@reprise.test')

    expect(report).toEqual({ favorites: 0, cartLines: 0, orders: 0, offers: 0 })
    expect(jar.get(shopSessionCookieName())).toBeDefined()
  })
})
