import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import type { CartOwner } from '@/lib/shop/cart'
import type { StartCheckoutInput } from '@/lib/validation/checkout'

/**
 * Un prix accepté devient-il RÉELLEMENT payable ?
 *
 * C'est la promesse que la boutique fait par e-mail : « ce prix reste payable
 * jusqu'au … ». Elle ne vaut que si le panier l'applique, si le paiement le
 * facture, et si la facture peut l'expliquer.
 *
 * Seul l'appel à Stripe est simulé. Le reste — offre, panier, transaction de
 * commande, vente — est exercé contre une vraie base.
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
const { readNegotiatedPrices } = await import('@/lib/shop/negotiated-price')
const { markOrderPaid } = await import('@/lib/shop/fulfilment')

const PREFIX = 'NEGO-'
const TOKEN = 'jeton-negociation-test'

const OWNER: CartOwner = {
  userId: null,
  sessionToken: TOKEN,
  lockOwnerId: TOKEN,
}

const INPUT: StartCheckoutInput = {
  email: 'negociatrice@exemple.fr',
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

const HOUR = 60 * 60 * 1000

async function cleanup(): Promise<void> {
  await prisma.offer.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: 'CMD-' }, email: INPUT.email } },
  })
  await prisma.order.deleteMany({ where: { email: INPUT.email } })
  await prisma.cartItem.deleteMany({ where: { cart: { sessionToken: TOKEN } } })
  await prisma.cart.deleteMany({ where: { sessionToken: TOKEN } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.job.deleteMany({})
}

beforeEach(async () => {
  await cleanup()
  created.mockReset()
  created.mockResolvedValue({
    id: `cs_test_${Math.random().toString(36).slice(2)}`,
    client_secret: 'secret_test',
  })
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(suffix: string, priceCents: number): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `nego-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents,
      costCents: 600,
      floorPriceCents: 1200,
      weightGrams: 400,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
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

/** Une offre déjà acceptée, valable un certain temps. */
async function acceptedOffer(
  articleId: string,
  amountCents: number,
  {
    validForHours = 24,
    sessionToken = TOKEN,
  }: { validForHours?: number; sessionToken?: string } = {},
): Promise<string> {
  const offer = await prisma.offer.create({
    data: {
      articleId,
      guestSessionToken: sessionToken,
      guestEmail: INPUT.email,
      amountCents,
      status: 'ACCEPTED',
      expiresAt: new Date(Date.now() + 48 * HOUR),
      priceValidUntil: new Date(Date.now() + validForHours * HOUR),
      respondedAt: new Date(),
    },
    select: { id: true },
  })
  return offer.id
}

async function anOption() {
  const { getShippingGrids } = await import('@/lib/db/queries/shipping')
  const { getShippingConfig } = await import('@/lib/config/settings')
  const { quoteShipping } = await import('@/lib/domain/shipping')

  const [grids, config] = await Promise.all([
    getShippingGrids(),
    getShippingConfig(),
  ])
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
  if (!quote.ok) throw new Error('devis impossible')

  const option = quote.quote.options.find((c) => !c.requiresServicePoint)
  if (!option) throw new Error('aucune option à domicile')
  return option
}

// ---------------------------------------------------------------------------
// Ce que le panier retient
// ---------------------------------------------------------------------------

describe('résolution du prix négocié', () => {
  it('retient une offre acceptée et encore valable', async () => {
    const articleId = await makeArticle('r1', 3800)
    const offerId = await acceptedOffer(articleId, 3000)

    const found = await readNegotiatedPrices(
      prisma,
      OWNER,
      [articleId],
      new Date(),
    )

    expect(found.get(articleId)).toMatchObject({ offerId, amountCents: 3000 })
  })

  it('ignore une offre dont la validité est passée', async () => {
    const articleId = await makeArticle('r2', 3800)
    await acceptedOffer(articleId, 3000, { validForHours: -1 })

    // Sans échéance, une pièce resterait négociée à un prix décidé il y a six
    // mois, sur un coût d'achat et une grille de port qui ont changé depuis.
    const found = await readNegotiatedPrices(prisma, OWNER, [articleId], new Date())
    expect(found.size).toBe(0)
  })

  it('ignore les offres qui ne sont pas ACCEPTÉES', async () => {
    const articleId = await makeArticle('r3', 3800)
    const offerId = await acceptedOffer(articleId, 3000)

    for (const status of ['PENDING', 'REJECTED', 'EXPIRED', 'VOIDED', 'CONSUMED'] as const) {
      await prisma.offer.update({ where: { id: offerId }, data: { status } })
      const found = await readNegotiatedPrices(prisma, OWNER, [articleId], new Date())
      expect(found.size, status).toBe(0)
    }
  })

  it('ignore l’offre de quelqu’un d’autre', async () => {
    const articleId = await makeArticle('r4', 3800)
    await acceptedOffer(articleId, 3000, { sessionToken: 'jeton-de-quelqu-un-dautre' })

    // Sinon un prix négocié par une personne profiterait à qui ouvre la même
    // fiche — sur un stock unitaire, ce serait la vendre à qui n'a rien
    // demandé, au prix de qui a négocié.
    const found = await readNegotiatedPrices(prisma, OWNER, [articleId], new Date())
    expect(found.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Ce que le paiement facture
// ---------------------------------------------------------------------------

describe('facturation', () => {
  it('facture le prix négocié, et le justifie sur la ligne', async () => {
    const option = await anOption()
    const articleId = await makeArticle('f1', 3800)
    const offerId = await acceptedOffer(articleId, 3000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: {
        carrierCode: option.carrierCode,
        serviceCode: option.serviceCode,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: {
        subtotalCents: true,
        items: { select: { unitPriceCents: true, offerId: true } },
      },
    })

    // Le montant vient de la BASE, recalculé dans la transaction. Le navigateur
    // n'a envoyé aucun prix.
    expect(order.subtotalCents).toBe(3000)
    expect(order.items[0]).toEqual({ unitPriceCents: 3000, offerId })
  })

  it('facture le prix affiché quand la validité est passée', async () => {
    const option = await anOption()
    const articleId = await makeArticle('f2', 3800)
    await acceptedOffer(articleId, 3000, { validForHours: -1 })
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: {
        carrierCode: option.carrierCode,
        serviceCode: option.serviceCode,
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { subtotalCents: true, items: { select: { offerId: true } } },
    })

    expect(order.subtotalCents).toBe(3800)
    expect(order.items[0]?.offerId).toBeNull()
  })

  it('ne fait JAMAIS payer plus cher pour avoir négocié', async () => {
    const option = await anOption()
    // Le prix affiché est descendu SOUS le prix négocié — une baisse
    // automatique, par exemple. Facturer l'offre punirait la négociation.
    const articleId = await makeArticle('f3', 2500)
    await acceptedOffer(articleId, 3000)
    const cartId = await makeCart([articleId])

    const result = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: {
        carrierCode: option.carrierCode,
        serviceCode: option.serviceCode,
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { subtotalCents: true },
    })
    expect(order.subtotalCents).toBe(2500)
  })
})

// ---------------------------------------------------------------------------
// Ce que la vente solde
// ---------------------------------------------------------------------------

describe('solde des négociations à la vente', () => {
  it('CONSOMME l’offre utilisée et ANNULE les autres', async () => {
    const option = await anOption()
    const articleId = await makeArticle('s1', 3800)
    const usedId = await acceptedOffer(articleId, 3000)
    const cartId = await makeCart([articleId])

    // Quelqu'un d'autre négociait la même pièce, et attendait une réponse.
    const otherId = await acceptedOffer(articleId, 3200, {
      sessionToken: 'jeton-dune-autre-personne',
    })
    await prisma.offer.update({
      where: { id: otherId },
      data: { status: 'PENDING', priceValidUntil: null, respondedAt: null },
    })

    const prepared = await prepareCheckoutFor(OWNER, cartId, {
      ...INPUT,
      shipping: {
        carrierCode: option.carrierCode,
        serviceCode: option.serviceCode,
      },
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    await markOrderPaid({
      orderId: prepared.orderId,
      paymentIntentId: null,
      paidAt: new Date(),
    })

    const [used, other] = await Promise.all([
      prisma.offer.findUniqueOrThrow({
        where: { id: usedId },
        select: { status: true },
      }),
      prisma.offer.findUniqueOrThrow({
        where: { id: otherId },
        select: { status: true, rejectionReason: true },
      }),
    ])

    // L'offre qui a servi a produit son effet : elle justifie un montant porté
    // sur une facture, et ne doit plus pouvoir en produire un second.
    // L'annuler ferait dire à la facture qu'elle s'appuie sur une offre « sans
    // objet ».
    expect(used.status).toBe('CONSUMED')

    // Celle de l'autre personne a perdu son objet — elle n'a pas été jugée.
    expect(other).toEqual({ status: 'VOIDED', rejectionReason: 'ARTICLE_SOLD' })
  })
})
