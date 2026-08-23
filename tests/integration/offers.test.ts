import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { getOfferPolicy } from '@/lib/config/settings'
import type { OfferPolicy } from '@/lib/domain/offers'
import { markOrderPaid } from '@/lib/shop/fulfilment'
import {
  expireStaleOffers,
  respondToOffer,
  submitOffer,
  voidOffersForArticles,
  type OfferOwner,
} from '@/lib/shop/offers'

/**
 * La négociation, contre une vraie base.
 *
 * Le domaine (`tests/domain/offers.test.ts`) couvre déjà les règles. Ce fichier
 * vérifie ce qui ne se simule pas : l'appariement d'une personne à ses offres
 * passées, la transition conditionnelle qui empêche une offre d'être acceptée
 * ET expirée, et le fait qu'une négociation ne verrouille RIEN.
 */

const PREFIX = 'OFFER-'

const ACCOUNT: OfferOwner = {
  userId: null, // renseigné au montage
  sessionToken: 'jeton-offre-compte',
  email: null,
}

const GUEST: OfferOwner = {
  userId: null,
  sessionToken: 'jeton-offre-invite',
  email: 'negociatrice@exemple.fr',
}

let policy: OfferPolicy
let articleId: string
let userId: string

/** Prix affiché 3800, minimum de la pièce 2100, plancher 2340. */
async function makeArticle(
  patch: {
    allowOffers?: boolean
    offersOpenAt?: Date | null
    status?: 'AVAILABLE' | 'RESERVED' | 'SOLD'
    minOfferCents?: number | null
  } = {},
): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({
    select: { id: true },
  })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${Math.random().toString(36).slice(2, 10)}`,
      slug: `offer-${Math.random().toString(36).slice(2, 10)}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 3800,
      costCents: 900,
      floorPriceCents: 2340,
      minOfferCents: patch.minOfferCents === undefined ? 2100 : patch.minOfferCents,
      weightGrams: 320,
      status: patch.status ?? 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      allowOffers: patch.allowOffers ?? true,
      offersOpenAt:
        patch.offersOpenAt === undefined
          ? new Date('2026-01-08T00:00:00Z')
          : patch.offersOpenAt,
      categoryId: category.id,
      ...(patch.status === 'RESERVED'
        ? {
            reservedById: 'quelqu-un',
            reservedUntil: new Date(Date.now() + 15 * 60_000),
          }
        : {}),
    },
    select: { id: true },
  })

  return article.id
}

async function cleanup(): Promise<void> {
  await prisma.offer.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await prisma.job.deleteMany({})
}

beforeEach(async () => {
  await cleanup()
  policy = await getOfferPolicy()

  const user = await prisma.user.create({
    data: { email: `${PREFIX}acheteuse@exemple.fr`, locale: 'fr' },
    select: { id: true },
  })
  userId = user.id
  ACCOUNT.userId = userId

  articleId = await makeArticle()
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

function submit(amountCents: number, owner: OfferOwner = ACCOUNT, id = articleId) {
  return submitOffer({ articleId: id, amountCents, owner, policy })
}

// ---------------------------------------------------------------------------
// Dépôt
// ---------------------------------------------------------------------------

describe('dépôt', () => {
  it('enregistre une offre en attente', async () => {
    const result = await submit(3000)

    expect(result).toMatchObject({ ok: true, outcome: 'pending' })

    const offer = await prisma.offer.findFirstOrThrow({
      where: { articleId },
      select: {
        amountCents: true,
        status: true,
        userId: true,
        guestEmail: true,
        respondedAt: true,
        priceValidUntil: true,
      },
    })

    expect(offer).toMatchObject({
      amountCents: 3000,
      status: 'PENDING',
      userId,
      guestEmail: null,
      respondedAt: null,
      priceValidUntil: null,
    })
  })

  it('ne verrouille RIEN', async () => {
    await submit(3000)

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true, reservedById: true, reservedUntil: true },
    })

    // Le brief l'interdit, et la raison tient au stock unitaire : immobiliser
    // une pièce quarante-huit heures au bénéfice de quelqu'un qui n'a rien
    // payé fait perdre des ventes fermes.
    expect(article).toEqual({
      status: 'AVAILABLE',
      reservedById: null,
      reservedUntil: null,
    })
  })

  it('ENREGISTRE le refus automatique, avec son motif', async () => {
    const result = await submit(2000)

    expect(result).toMatchObject({ ok: true, outcome: 'auto-rejected' })

    const offer = await prisma.offer.findFirstOrThrow({
      where: { articleId },
      select: { status: true, rejectionReason: true, respondedAt: true },
    })

    // Ne rien écrire ferait disparaître la proposition sans trace : pas de
    // réponse, pas de tentative comptée, pas de carence — donc un refus qui se
    // contourne en boucle.
    expect(offer.status).toBe('REJECTED')
    expect(offer.rejectionReason).toBe('AUTO_BELOW_MIN')
    expect(offer.respondedAt).not.toBeNull()
  })

  it('refuse une pièce inconnue', async () => {
    const result = await submitOffer({
      articleId: 'aucune-piece',
      amountCents: 3000,
      owner: ACCOUNT,
      policy,
    })
    expect(result).toEqual({ ok: false, rejection: 'article-unknown' })
  })

  it('refuse une seconde offre tant que la première attend', async () => {
    expect((await submit(3000)).ok).toBe(true)
    expect(await submit(3200)).toEqual({
      ok: false,
      rejection: 'already-pending',
    })
  })

  it('compte les tentatives d’une même personne sur une même pièce', async () => {
    // Trois tentatives autorisées par défaut. On passe par l'expiration plutôt
    // que par le refus : un refus ouvre une carence, qui répondrait AVANT le
    // plafond et masquerait ce qu'on veut vérifier.
    for (let round = 0; round < 3; round += 1) {
      expect((await submit(3000)).ok, `tour ${round + 1}`).toBe(true)
      await prisma.offer.updateMany({
        where: { articleId, status: 'PENDING' },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      })
      await expireStaleOffers()
    }

    expect(await submit(3000)).toMatchObject({ rejection: 'too-many-attempts' })
  })

  it('un refus automatique consomme une tentative', async () => {
    // Sinon, marteler des offres dérisoires serait gratuit.
    await submit(2000)

    const attempts = await prisma.offer.count({
      where: { articleId, parentOfferId: null, userId },
    })
    expect(attempts).toBe(1)
  })

  it('ne fait pas payer à l’acheteuse les contre-offres du vendeur', async () => {
    const first = await submit(3000)
    if (!first.ok) throw new Error('dépôt refusé')

    // Le vendeur contre : une nouvelle offre PENDING apparaît, portant la même
    // identité que l'acheteuse. Elle ne doit pas consommer son plafond — sinon
    // trois allers-retours voulus par la boutique lui interdiraient de
    // proposer quoi que ce soit sur cette pièce.
    await respondToOffer({
      offerId: first.offerId,
      response: { action: 'counter', counterAmountCents: 3400 },
      policy,
    })

    // La contre-offre attend une réponse : rien de neuf ne se dépose.
    expect(await submit(3200)).toMatchObject({ rejection: 'already-pending' })

    await prisma.offer.updateMany({
      where: { articleId, status: 'PENDING' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    await expireStaleOffers()

    // Une seule tentative consommée sur trois : celle de l'acheteuse.
    expect((await submit(3200)).ok).toBe(true)
  })

  it('ouvre un délai de carence après un refus', async () => {
    await submit(2000)

    const verdict = await submit(2500)
    expect(verdict).toMatchObject({ ok: false, rejection: 'cooldown' })
    if (verdict.ok) throw new Error('inattendu')
    expect(verdict.retryAt).toBeInstanceOf(Date)
  })

  it('n’oppose pas les offres d’une personne à celles d’une autre', async () => {
    await submit(3000, ACCOUNT)

    // Le compte a une offre en attente ; l'invité doit pouvoir déposer la
    // sienne. Sans appariement par identité, le second se verrait refuser une
    // offre à cause de la première.
    expect(await submit(3100, GUEST)).toMatchObject({ ok: true })
  })

  it('apparie une offre sans compte au jeton ET à l’adresse', async () => {
    await submit(3000, GUEST)

    // Même jeton, autre adresse : c'est quelqu'un d'autre sur le même
    // navigateur partagé. Sans la double condition, il hériterait de l'offre
    // en attente de la personne précédente.
    const other = { ...GUEST, email: 'quelqu-un-dautre@exemple.fr' }
    expect(await submit(3100, other)).toMatchObject({ ok: true })

    // Même adresse, autre jeton : sans la condition sur le jeton, n'importe
    // qui pourrait faire ouvrir un délai de carence à quelqu'un en devinant
    // son e-mail.
    const elsewhere = { ...GUEST, sessionToken: 'jeton-inconnu' }
    expect(await submit(3200, elsewhere)).toMatchObject({ ok: true })
  })

  it('enregistre l’identité d’une offre sans compte', async () => {
    await submit(3000, GUEST)

    const offer = await prisma.offer.findFirstOrThrow({
      where: { articleId },
      select: { userId: true, guestEmail: true, guestSessionToken: true },
    })

    expect(offer).toEqual({
      userId: null,
      guestEmail: GUEST.email,
      guestSessionToken: GUEST.sessionToken,
    })
  })

  it('refuse sur une pièce en cours de paiement', async () => {
    const reserved = await makeArticle({ status: 'RESERVED' })
    expect(await submit(3000, ACCOUNT, reserved)).toMatchObject({
      rejection: 'article-unavailable',
    })
  })
})

// ---------------------------------------------------------------------------
// Réponse
// ---------------------------------------------------------------------------

describe('réponse du vendeur', () => {
  async function pending(amountCents = 3000): Promise<string> {
    const result = await submit(amountCents)
    if (!result.ok) throw new Error(`dépôt refusé : ${result.rejection}`)
    return result.offerId
  }

  it('accepte et pose la validité du prix', async () => {
    const offerId = await pending()
    const result = await respondToOffer({
      offerId,
      response: { action: 'accept' },
      policy,
    })

    expect(result).toMatchObject({ ok: true, status: 'ACCEPTED', belowFloor: false })

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { status: true, priceValidUntil: true, respondedAt: true },
    })
    expect(offer.status).toBe('ACCEPTED')
    expect(offer.priceValidUntil).not.toBeNull()
    expect(offer.respondedAt).not.toBeNull()
  })

  it('accepter ne réserve pas la pièce', async () => {
    const offerId = await pending()
    await respondToOffer({ offerId, response: { action: 'accept' }, policy })

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true, reservedById: true },
    })

    // Le prix négocié est une PROMESSE DE PRIX bornée dans le temps, pas une
    // mise de côté. La pièce reste en vente au prix affiché.
    expect(article).toEqual({ status: 'AVAILABLE', reservedById: null })
  })

  it('trace un franchissement de plancher', async () => {
    // 2200 : au-dessus du minimum de la pièce ? Non — on abaisse le minimum
    // pour que l'offre soit déposée, et elle reste sous le plancher de 2340.
    const low = await makeArticle({ minOfferCents: null })
    const submitted = await submit(2200, ACCOUNT, low)
    if (!submitted.ok) throw new Error('dépôt refusé')

    const result = await respondToOffer({
      offerId: submitted.offerId,
      response: { action: 'accept' },
      policy,
    })

    // On n'interdit pas : le vendeur a le droit de vendre à perte. On
    // enregistre, pour que la vente reste explicable six mois plus tard.
    expect(result).toMatchObject({ ok: true, belowFloor: true })
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: submitted.offerId },
      select: { acceptedBelowFloor: true },
    })
    expect(offer.acceptedBelowFloor).toBe(true)
  })

  it('refuse et note le motif', async () => {
    const offerId = await pending()
    await respondToOffer({ offerId, response: { action: 'reject' }, policy })

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { status: true, rejectionReason: true },
    })
    expect(offer).toEqual({ status: 'REJECTED', rejectionReason: 'MANUAL' })
  })

  it('contre-offre : une NOUVELLE offre, chaînée', async () => {
    const offerId = await pending(3000)
    const result = await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 3400 },
      policy,
    })

    expect(result).toMatchObject({ ok: true, status: 'COUNTERED' })
    if (!result.ok || !result.counterOfferId) throw new Error('inattendu')

    const counter = await prisma.offer.findUniqueOrThrow({
      where: { id: result.counterOfferId },
      select: { amountCents: true, status: true, parentOfferId: true, userId: true },
    })

    // La modéliser comme un simple champ perdrait l'historique : on ne saurait
    // plus qui a proposé quoi.
    expect(counter).toEqual({
      amountCents: 3400,
      status: 'PENDING',
      parentOfferId: offerId,
      userId,
    })
  })

  it('refuse une contre-offre qui n’en est pas une', async () => {
    const offerId = await pending(3000)

    // Sous l'offre reçue : négocier contre soi-même.
    expect(
      await respondToOffer({
        offerId,
        response: { action: 'counter', counterAmountCents: 2900 },
        policy,
      }),
    ).toEqual({ ok: false, reason: 'invalid-counter' })

    // Au prix affiché : ce n'est plus une négociation.
    expect(
      await respondToOffer({
        offerId,
        response: { action: 'counter', counterAmountCents: 3800 },
        policy,
      }),
    ).toEqual({ ok: false, reason: 'invalid-counter' })
  })

  it('ne répond pas deux fois à la même offre', async () => {
    const offerId = await pending()
    expect(
      (await respondToOffer({ offerId, response: { action: 'accept' }, policy })).ok,
    ).toBe(true)

    // Transition conditionnelle : le second clic — ou le balayage qui tombe au
    // même instant — ne peut pas écraser la première réponse.
    expect(
      await respondToOffer({ offerId, response: { action: 'reject' }, policy }),
    ).toEqual({ ok: false, reason: 'not-pending' })
  })

  it('refuse d’agir sur une pièce déjà vendue', async () => {
    const offerId = await pending()
    await prisma.article.update({
      where: { id: articleId },
      data: { status: 'SOLD', soldAt: new Date() },
    })

    expect(
      await respondToOffer({ offerId, response: { action: 'accept' }, policy }),
    ).toEqual({ ok: false, reason: 'article-unavailable' })
  })

  it('refuse une offre introuvable', async () => {
    expect(
      await respondToOffer({
        offerId: 'aucune-offre',
        response: { action: 'accept' },
        policy,
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})

// ---------------------------------------------------------------------------
// Le temps, et la vente
// ---------------------------------------------------------------------------

describe('extinction', () => {
  it('éteint les offres échues, et elles seules', async () => {
    const fresh = await submit(3000, ACCOUNT)
    const other = await makeArticle()
    const stale = await submit(3000, ACCOUNT, other)
    if (!fresh.ok || !stale.ok) throw new Error('dépôt refusé')

    await prisma.offer.update({
      where: { id: stale.offerId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    expect(await expireStaleOffers()).toBe(1)

    const rows = await prisma.offer.findMany({
      where: { id: { in: [fresh.offerId, stale.offerId] } },
      select: { id: true, status: true },
    })

    expect(rows.find((row) => row.id === stale.offerId)?.status).toBe('EXPIRED')
    expect(rows.find((row) => row.id === fresh.offerId)?.status).toBe('PENDING')
  })

  it('est idempotent', async () => {
    const result = await submit(3000)
    if (!result.ok) throw new Error('dépôt refusé')
    await prisma.offer.update({
      where: { id: result.offerId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    expect(await expireStaleOffers()).toBe(1)
    expect(await expireStaleOffers()).toBe(0)
  })

  it('annule les négociations d’une pièce vendue', async () => {
    const submitted = await submit(3000)
    if (!submitted.ok) throw new Error('dépôt refusé')

    await prisma.$transaction((tx) => voidOffersForArticles(tx, [articleId]))

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: submitted.offerId },
      select: { status: true, rejectionReason: true },
    })

    // VOIDED et non REJECTED : la proposition n'a pas été jugée, elle a perdu
    // son objet. Les confondre ouvrirait un délai de carence à quelqu'un qui
    // n'a rien fait de mal.
    expect(offer).toEqual({ status: 'VOIDED', rejectionReason: 'ARTICLE_SOLD' })
  })

  it('la vente éteint les négociations en cours', async () => {
    const submitted = await submit(3000)
    if (!submitted.ok) throw new Error('dépôt refusé')

    const order = await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}CMD1`,
        email: 'acheteuse@exemple.fr',
        locale: 'fr',
        status: 'PENDING_PAYMENT',
        subtotalCents: 3800,
        shippingCents: 0,
        totalCents: 3800,
        shippingAddress: {},
        billingAddress: {},
        shippingCarrierCode: 'mock',
        shippingServiceCode: 'standard',
        items: {
          create: [
            {
              articleId,
              titleSnapshot: 'Chemise',
              imageSnapshot: '',
              unitPriceCents: 3800,
              costCentsSnapshot: 900,
            },
          ],
        },
      },
      select: { id: true },
    })

    await markOrderPaid({
      orderId: order.id,
      paymentIntentId: null,
      paidAt: new Date(),
    })

    // Sans cela, une acceptation quelques heures plus tard promettrait un prix
    // sur un vêtement qui n'existe plus — et la personne l'apprendrait au
    // moment de payer.
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: submitted.offerId },
      select: { status: true },
    })
    expect(offer.status).toBe('VOIDED')
  })
})
