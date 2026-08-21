import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import type { StartCheckoutInput } from '@/lib/validation/checkout'
import type { CartOwner } from '@/lib/shop/cart'

/**
 * Ouverture d'un paiement, contre une vraie base.
 *
 * Ce qui compte ici : le montant envoyé au paiement vient-il RÉELLEMENT du
 * serveur, et le stock est-il verrouillé de façon à ce que deux personnes ne
 * puissent pas payer la même pièce ?
 *
 * Seul l'appel à Stripe est simulé — c'est le seul tiers réseau du chemin. Le
 * verrou, la transaction et les totaux sont exercés pour de vrai : les simuler
 * reviendrait à tester notre imagination de PostgreSQL.
 */

const created = vi.hoisted(() => vi.fn())
const expired = vi.hoisted(() => vi.fn())

vi.mock('@/lib/payments/stripe', () => ({
  isStripeConfigured: () => true,
  stripe: () => ({
    checkout: { sessions: { create: created, expire: expired } },
  }),
  StripeNotConfiguredError: class extends Error {},
  __resetStripeClientForTests: () => {},
}))

const { prepareCheckoutFor } = await import('@/lib/shop/checkout')

const PREFIX = 'CHKOUT-'
const TOKEN = 'jeton-checkout-test'

const OWNER: CartOwner = {
  userId: null,
  sessionToken: TOKEN,
  lockOwnerId: TOKEN,
}

const INPUT: StartCheckoutInput = {
  email: 'acheteuse@exemple.fr',
  locale: 'fr',
  shippingAddress: {
    firstName: 'Nina',
    lastName: 'Exemple',
    line1: '12 rue du Registre',
    postalCode: '59000',
    city: 'Lille',
    country: 'FR',
  },
  shipping: { carrierCode: '', serviceCode: '' },
  acceptsTerms: true,
}

async function cleanup(): Promise<void> {
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: 'CMD-' }, email: INPUT.email } },
  })
  await prisma.order.deleteMany({ where: { email: INPUT.email } })
  await prisma.cartItem.deleteMany({ where: { cart: { sessionToken: TOKEN } } })
  await prisma.cart.deleteMany({ where: { sessionToken: TOKEN } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

beforeEach(async () => {
  await cleanup()
  created.mockReset()
  created.mockResolvedValue({ id: 'cs_test_1', client_secret: 'cs_secret_1' })
  expired.mockReset()
  expired.mockResolvedValue({ id: 'cs_test_1', status: 'expired' })
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(suffix: string, priceCents: number, weightGrams = 400) {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `checkout-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents,
      costCents: Math.round(priceCents / 3),
      floorPriceCents: Math.round(priceCents / 2),
      weightGrams,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
      translations: {
        create: [{ locale: 'fr', title: `Pièce ${suffix}`, description: 'Essai' }],
      },
    },
    select: { id: true },
  })

  return article.id
}

async function makeCart(articleIds: string[]): Promise<string> {
  const cart = await prisma.cart.create({
    data: {
      sessionToken: TOKEN,
      items: {
        create: articleIds.map((articleId) => ({
          articleId,
          unitPriceCents: 0,
          priceSource: 'LIST' as const,
        })),
      },
    },
    select: { id: true },
  })
  return cart.id
}

/**
 * Une option réellement proposée pour cette destination.
 *
 * `withServicePoint` choisit entre livraison à domicile et point relais : le
 * jeu de données propose les deux, et le second exige un identifiant de point.
 */
async function anOption(withServicePoint = false) {
  const { getShippingGrids } = await import('@/lib/db/queries/shipping')
  const { getShippingConfig } = await import('@/lib/config/settings')
  const { quoteShipping } = await import('@/lib/domain/shipping')

  const [grids, config] = await Promise.all([getShippingGrids(), getShippingConfig()])
  const quote = quoteShipping(
    {
      destination: { countryCode: 'FR', postalCode: '59000' },
      articleWeightsGrams: [400],
      subtotalCents: 2000,
    },
    grids.zones,
    grids.rates,
    config,
  )

  if (!quote.ok) throw new Error(`devis impossible : ${quote.failure.reason}`)

  const option = quote.quote.options.find(
    (candidate) => candidate.requiresServicePoint === withServicePoint,
  )
  if (!option) {
    throw new Error(
      `aucune option ${withServicePoint ? 'point relais' : 'à domicile'} dans le jeu de données`,
    )
  }
  return option
}

describe('ouverture d’un paiement', () => {
  it('crée la commande, verrouille le stock et ouvre une session', async () => {
    const option = await anOption()
    const articleId = await makeArticle('a1', 2500)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.orderNumber).toMatch(/^CMD-\d{4}-\d{6}$/)
    expect(result.clientSecret).toBe('cs_secret_1')

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: {
        status: true,
        subtotalCents: true,
        shippingCents: true,
        totalCents: true,
        shippingCostCents: true,
        stripeSessionId: true,
        cgvVersion: true,
        cgvAcceptedAt: true,
        items: { select: { unitPriceCents: true, costCentsSnapshot: true } },
      },
    })

    expect(order.status).toBe('PENDING_PAYMENT')
    expect(order.subtotalCents).toBe(2500)
    expect(order.stripeSessionId).toBe('cs_test_1')
    // Preuve d'acceptation, horodatée et versionnée.
    expect(order.cgvVersion).toBeTruthy()
    expect(order.cgvAcceptedAt).not.toBeNull()
    // Coût transporteur réel : privé, gardé pour le suivi de marge.
    expect(order.shippingCostCents).toBe(option.carrierCostCents)
    expect(order.items[0]?.costCentsSnapshot).toBeGreaterThan(0)

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true, reservedById: true, reservedUntil: true },
    })
    expect(article.status).toBe('RESERVED')
    expect(article.reservedById).toBe(TOKEN)
    expect(article.reservedUntil).not.toBeNull()
  })

  it('envoie au paiement une somme égale au total enregistré', async () => {
    const option = await anOption()
    const ids = [await makeArticle('b1', 1900), await makeArticle('b2', 3300)]
    const cartId = await makeCart(ids)

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const call = created.mock.calls[0]?.[0] as {
      line_items: { price_data: { unit_amount: number; currency: string } }[]
      currency: string
    }

    const sum = call.line_items.reduce(
      (total, item) => total + item.price_data.unit_amount,
      0,
    )
    // L'invariant qui compte : ce que Stripe débitera est ce que la base dit.
    expect(sum).toBe(result.totalCents)

    // Devise cohérente sur toutes les lignes et sur la session.
    expect(call.currency).toBe('eur')
    for (const item of call.line_items) {
      expect(item.price_data.currency).toBe('eur')
    }
  })

  it('la session de paiement ne survit JAMAIS au verrou de stock', async () => {
    // C'est l'invariant qui empêche de vendre une pièce qu'on ne peut plus
    // livrer : si la session durait plus longtemps que la réservation, la
    // pièce redeviendrait libre pendant que quelqu'un saisit sa carte.
    //
    // Stripe impose trente minutes minimum à une session ; c'est donc le
    // verrou qu'on allonge, jamais la session qu'on raccourcit.
    const option = await anOption()
    const articleId = await makeArticle('h1', 2000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const call = created.mock.calls[0]?.[0] as { expires_at: number }
    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { reservedUntil: true },
    })

    expect(article.reservedUntil).not.toBeNull()
    const lockSeconds = Math.floor(article.reservedUntil!.getTime() / 1000)

    expect(call.expires_at).toBeLessThanOrEqual(lockSeconds)
    // Et le verrou couvre bien le minimum imposé par Stripe, même si le
    // réglage `reservationTtlMinutes` est plus court (15 minutes au seed).
    expect(call.expires_at).toBeGreaterThan(Date.now() / 1000 + 29 * 60)
  })

  it('facture le prix EN BASE, pas celui mémorisé au panier', async () => {
    // L'instantané du panier vaut 0 dans ce jeu d'essai. S'il entrait dans un
    // total, la commande serait gratuite.
    const option = await anOption()
    const articleId = await makeArticle('c1', 4200)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { subtotalCents: true, items: { select: { unitPriceCents: true } } },
    })
    expect(order.subtotalCents).toBe(4200)
    expect(order.items[0]?.unitPriceCents).toBe(4200)
  })
})

describe('refus', () => {
  it('refuse un mode de livraison qui n’a pas été proposé', async () => {
    // Le client envoie deux identifiants, jamais un montant. Un identifiant
    // inconnu ne doit pas devenir une livraison gratuite.
    const articleId = await makeArticle('d1', 2000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: 'transporteur-inconnu', serviceCode: 'express' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('unknown-shipping-option')

    // Et rien n'a été verrouillé au passage.
    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('AVAILABLE')
    expect(created).not.toHaveBeenCalled()
  })

  it('refuse une destination que la grille ne couvre pas', async () => {
    const articleId = await makeArticle('d2', 2000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shippingAddress: { ...INPUT.shippingAddress, country: 'JP', postalCode: '1000001' },
      shipping: { carrierCode: 'x', serviceCode: 'y' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    // Une adresse qu'on ne sait pas desservir le dit, elle n'est pas facturée
    // au hasard.
    expect(result.failure.reason).toBe('shipping-unavailable')
  })

  it('refuse un point relais sans point choisi', async () => {
    // Le service exige un identifiant de point ; on ne le devine pas et on ne
    // livre pas « quelque part ».
    const option = await anOption(true)
    const articleId = await makeArticle('d3', 2000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('service-point-required')

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('AVAILABLE')
  })

  it('accepte un point relais avec son identifiant', async () => {
    const option = await anOption(true)
    const articleId = await makeArticle('d4', 2000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: {
        carrierCode: option.carrierCode,
        serviceCode: option.serviceCode,
        servicePointId: 'PR-59000-042',
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { servicePointId: true },
    })
    expect(order.servicePointId).toBe('PR-59000-042')
  })

  it('refuse un panier vide', async () => {
    const cartId = await makeCart([])

    const result = await prepareCheckoutFor(OWNER, cartId, INPUT)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('empty-cart')
  })

  it('nomme les lignes bloquées au lieu de les retirer en silence', async () => {
    const option = await anOption()
    const good = await makeArticle('e1', 2000)
    const gone = await makeArticle('e2', 2000)
    await prisma.article.update({
      where: { id: gone },
      data: { status: 'SOLD', soldAt: new Date() },
    })
    const cartId = await makeCart([good, gone])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('blocked-lines')
    if (result.failure.reason !== 'blocked-lines') return
    expect(result.failure.articleIds).toEqual([gone])

    // La pièce encore disponible n'est ni verrouillée ni vendue : on n'engage
    // rien tant que la personne n'a pas tranché.
    const still = await prisma.article.findUniqueOrThrow({
      where: { id: good },
      select: { status: true },
    })
    expect(still.status).toBe('AVAILABLE')
  })

  it('refuse quand une pièce vient d’être prise par quelqu’un d’autre', async () => {
    const option = await anOption()
    const articleId = await makeArticle('f1', 2000)
    // Verrou vivant, tenu par un AUTRE propriétaire.
    await prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'RESERVED',
        reservedById: 'quelqu-un-d-autre',
        reservedUntil: new Date(Date.now() + 900_000),
      },
    })
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    // Qualifié dès la lecture du panier : la ligne n'est pas payable.
    expect(result.failure.reason).toBe('blocked-lines')
    expect(created).not.toHaveBeenCalled()
  })
})

describe('panne du prestataire de paiement', () => {
  it('rend le stock et annule la commande si la session ne s’ouvre pas', async () => {
    // Sans cela, une panne réseau immobiliserait la pièce jusqu'à l'expiration
    // du verrou, pour une commande qui ne pourra jamais être payée.
    const option = await anOption()
    const articleId = await makeArticle('g1', 2000)
    const cartId = await makeCart([articleId])

    created.mockRejectedValueOnce(new Error('Stripe injoignable'))

    await expect(
      prepareCheckoutFor(OWNER, cartId, {
        ...INPUT,
        shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
      }),
    ).rejects.toThrow('Stripe injoignable')

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true, reservedById: true },
    })
    expect(article.status).toBe('AVAILABLE')
    expect(article.reservedById).toBeNull()

    const order = await prisma.order.findFirstOrThrow({
      where: { email: INPUT.email },
      select: { status: true, cancelledAt: true },
    })
    expect(order.status).toBe('CANCELLED')
    expect(order.cancelledAt).not.toBeNull()
  })

  it('annule aussi si la session revient sans secret client', async () => {
    const option = await anOption()
    const articleId = await makeArticle('g2', 2000)
    const cartId = await makeCart([articleId])

    created.mockResolvedValueOnce({ id: 'cs_test_2', client_secret: null })

    await expect(
      prepareCheckoutFor(OWNER, cartId, {
        ...INPUT,
        shipping: { carrierCode: option.carrierCode, serviceCode: option.serviceCode },
      }),
    ).rejects.toThrow()

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('AVAILABLE')
  })
})

describe('un seul paiement vivant par pièce', () => {
  it('écarte la commande précédente au lieu d’en ouvrir une seconde', async () => {
    // Reproduit par la revue adverse : le verrou de stock admet volontairement
    // la reprise par le MÊME propriétaire. Deux onglets du même acheteur
    // ouvraient donc deux commandes vivantes sur la même pièce, deux sessions,
    // deux débits — pour un seul exemplaire.
    const option = await anOption()
    const articleId = await makeArticle('i1', 2000)
    const cartId = await makeCart([articleId])
    const shipping = {
      carrierCode: option.carrierCode,
      serviceCode: option.serviceCode,
    }

    const first = await prepareCheckoutFor(OWNER, cartId, { ...INPUT, shipping })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    created.mockResolvedValueOnce({ id: 'cs_test_2', client_secret: 'cs_secret_2' })
    const second = await prepareCheckoutFor(OWNER, cartId, { ...INPUT, shipping })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    // La première commande est écartée, pas laissée payable en parallèle.
    const before = await prisma.order.findUniqueOrThrow({
      where: { id: first.orderId },
      select: { status: true },
    })
    expect(before.status).toBe('CANCELLED')

    // Et sa session de paiement est réellement fermée chez Stripe : sinon
    // l'onglet précédent resterait payable.
    expect(expired).toHaveBeenCalledWith('cs_test_1')

    const live = await prisma.order.count({
      where: { email: INPUT.email, status: 'PENDING_PAYMENT' },
    })
    expect(live).toBe(1)
  })

  it('résiste à deux tentatives simultanées du même acheteur', async () => {
    const option = await anOption()
    const articleId = await makeArticle('i2', 2000)
    const cartId = await makeCart([articleId])
    const shipping = {
      carrierCode: option.carrierCode,
      serviceCode: option.serviceCode,
    }

    let n = 0
    created.mockImplementation(() => {
      n += 1
      return Promise.resolve({ id: `cs_race_${n}`, client_secret: `sec_${n}` })
    })

    // Deux onglets, au même instant. Le verrou consultatif pris en tête de
    // transaction sérialise les deux : la seconde voit la première.
    const results = await Promise.all([
      prepareCheckoutFor(OWNER, cartId, { ...INPUT, shipping }),
      prepareCheckoutFor(OWNER, cartId, { ...INPUT, shipping }),
    ])

    for (const result of results) expect(result.ok).toBe(true)

    const live = await prisma.order.count({
      where: { email: INPUT.email, status: 'PENDING_PAYMENT' },
    })
    // L'invariant : une seule commande payable sur cette pièce, quoi qu'il
    // arrive.
    expect(live).toBe(1)
  })
})
