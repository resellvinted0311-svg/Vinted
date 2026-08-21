import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  markOrderPaid,
  expireOrder,
  expireStaleOrders,
} from '@/lib/shop/fulfilment'

/**
 * Confirmation d'une vente, contre une vraie base.
 *
 * Ce qui se joue ici ne se simule pas : la question est de savoir ce qui reste
 * en base après qu'un webhook a été rejoué, après qu'une expiration est arrivée
 * en retard, et après qu'une pièce a été vendue à quelqu'un d'autre entre-temps.
 */

const PREFIX = 'FULFIL-'

async function cleanup(): Promise<void> {
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(suffix: string, status: 'AVAILABLE' | 'RESERVED' | 'SOLD' = 'RESERVED') {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  return prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `fulfil-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 2000,
      costCents: 600,
      floorPriceCents: 1200,
      weightGrams: 400,
      status,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
      ...(status === 'RESERVED'
        ? {
            reservedById: 'proprietaire-test',
            reservedUntil: new Date(Date.now() + 900_000),
          }
        : {}),
      ...(status === 'SOLD' ? { soldAt: new Date() } : {}),
    },
    select: { id: true },
  })
}

async function makeOrder(suffix: string, articleIds: string[]) {
  return prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      email: 'acheteuse@exemple.fr',
      locale: 'fr',
      status: 'PENDING_PAYMENT',
      subtotalCents: 2000 * articleIds.length,
      shippingCents: 490,
      totalCents: 2000 * articleIds.length + 490,
      shippingAddress: { city: 'Lille' },
      billingAddress: { city: 'Lille' },
      shippingCarrierCode: 'mock',
      shippingServiceCode: 'standard',
      items: {
        create: articleIds.map((articleId) => ({
          articleId,
          titleSnapshot: 'Pull en laine',
          imageSnapshot: '',
          unitPriceCents: 2000,
          costCentsSnapshot: 600,
        })),
      },
    },
    select: { id: true },
  })
}

const PAID_AT = new Date('2026-08-21T10:00:00.000Z')

describe('marquer une commande payée', () => {
  it('passe la commande en payée et la pièce en vendue', async () => {
    const article = await makeArticle('a1')
    const order = await makeOrder('001', [article.id])

    const result = await markOrderPaid({
      orderId: order.id,
      paymentIntentId: 'pi_test_1',
      paidAt: PAID_AT,
    })

    expect(result.applied).toBe(true)
    expect(result.soldArticleIds).toEqual([article.id])
    expect(result.unfulfillableArticleIds).toEqual([])

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paidAt: true, stripePaymentIntentId: true },
    })
    expect(after.status).toBe('PAID')
    expect(after.paidAt).toEqual(PAID_AT)
    expect(after.stripePaymentIntentId).toBe('pi_test_1')

    const sold = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true, soldAt: true, reservedById: true, reservedUntil: true },
    })
    expect(sold.status).toBe('SOLD')
    expect(sold.soldAt).not.toBeNull()
    // Le verrou n'a plus lieu d'être : la vente a remplacé la réservation.
    expect(sold.reservedById).toBeNull()
    expect(sold.reservedUntil).toBeNull()
  })

  it('rejouée, ne refait rien et ne redate pas la vente', async () => {
    // Stripe rejoue : sur timeout, sur 500, pendant un déploiement, et parfois
    // simplement en doublon.
    const article = await makeArticle('a2')
    const order = await makeOrder('002', [article.id])

    await markOrderPaid({ orderId: order.id, paymentIntentId: 'pi_1', paidAt: PAID_AT })

    const replay = await markOrderPaid({
      orderId: order.id,
      paymentIntentId: 'pi_1',
      paidAt: new Date('2026-08-21T14:00:00.000Z'),
    })

    expect(replay.applied).toBe(false)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { paidAt: true },
    })
    // La date de la facture ne bouge pas parce qu'un webhook est arrivé en
    // retard : elle doit correspondre au relevé bancaire.
    expect(after.paidAt).toEqual(PAID_AT)
  })

  it('n’écrase jamais la vente de quelqu’un d’autre', async () => {
    // La conception ferme ce cas — le verrou dure au moins aussi longtemps que
    // la session de paiement. Mais une garantie de conception n'est pas une
    // garantie d'exécution : un article libéré à la main depuis le back-office
    // suffit à le rouvrir. Le jour où cela arrive, la vente de l'autre
    // personne ne doit pas être écrasée.
    const mine = await makeArticle('a3')
    const taken = await makeArticle('a4', 'SOLD')
    const soldAtBefore = (
      await prisma.article.findUniqueOrThrow({
        where: { id: taken.id },
        select: { soldAt: true },
      })
    ).soldAt

    const order = await makeOrder('003', [mine.id, taken.id])

    const result = await markOrderPaid({
      orderId: order.id,
      paymentIntentId: 'pi_2',
      paidAt: PAID_AT,
    })

    // L'argent EST pris : nier le débit serait pire que de le constater.
    expect(result.applied).toBe(true)
    expect(result.soldArticleIds).toEqual([mine.id])
    expect(result.unfulfillableArticleIds).toEqual([taken.id])

    // La vente de l'autre personne est intacte.
    const other = await prisma.article.findUniqueOrThrow({
      where: { id: taken.id },
      select: { soldAt: true },
    })
    expect(other.soldAt).toEqual(soldAtBefore)
  })

  it('consigne les lignes non honorables pour qu’une personne les voie', async () => {
    const taken = await makeArticle('a5', 'SOLD')
    const order = await makeOrder('004', [taken.id])

    await markOrderPaid({ orderId: order.id, paymentIntentId: 'pi_3', paidAt: PAID_AT })

    const logged = await prisma.auditLog.findFirst({
      where: { entity: 'Order', entityId: order.id, action: 'order.unfulfillable_lines' },
      select: { after: true },
    })

    // Consigné, pas résolu : le remboursement est une décision humaine.
    expect(logged).not.toBeNull()
    expect(JSON.stringify(logged?.after)).toContain(taken.id)
  })

  it('refuse une commande inexistante plutôt que d’échouer en silence', async () => {
    await expect(
      markOrderPaid({ orderId: 'inexistante', paymentIntentId: null, paidAt: PAID_AT }),
    ).rejects.toThrow()
  })
})

describe('expiration d’une commande', () => {
  it('rend le stock et annule la commande', async () => {
    const article = await makeArticle('b1')
    const order = await makeOrder('101', [article.id])

    expect(await expireOrder(order.id)).toBe(true)

    const released = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true, reservedById: true, reservedUntil: true },
    })
    expect(released.status).toBe('AVAILABLE')
    expect(released.reservedById).toBeNull()
    expect(released.reservedUntil).toBeNull()

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, cancelledAt: true },
    })
    expect(after.status).toBe('CANCELLED')
    expect(after.cancelledAt).not.toBeNull()
  })

  it('ne défait JAMAIS une vente déjà conclue', async () => {
    // Un événement d'expiration peut arriver après un paiement réussi. S'il
    // remettait la pièce en vente, on la vendrait deux fois.
    const article = await makeArticle('b2')
    const order = await makeOrder('102', [article.id])

    await markOrderPaid({ orderId: order.id, paymentIntentId: 'pi_4', paidAt: PAID_AT })
    expect(await expireOrder(order.id)).toBe(false)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    })
    expect(after.status).toBe('PAID')

    const still = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true },
    })
    expect(still.status).toBe('SOLD')
  })

  it('ne touche pas à une pièce vendue à quelqu’un d’autre', async () => {
    const taken = await makeArticle('b3', 'SOLD')
    const order = await makeOrder('103', [taken.id])

    await expireOrder(order.id)

    const other = await prisma.article.findUniqueOrThrow({
      where: { id: taken.id },
      select: { status: true },
    })
    expect(other.status).toBe('SOLD')
  })
})

describe('balayage des commandes fantômes', () => {
  it('annule une commande en attente depuis trop longtemps', async () => {
    // Stripe envoie bien un événement d'expiration, mais un webhook peut se
    // perdre. Sans ce balayage, la commande resterait en attente pour
    // toujours alors que son stock a été rendu.
    const article = await makeArticle('c1')
    const order = await makeOrder('201', [article.id])
    await prisma.order.update({
      where: { id: order.id },
      data: { createdAt: new Date(Date.now() - 4 * 3_600_000) },
    })

    const cancelled = await expireStaleOrders(120)
    expect(cancelled).toBeGreaterThanOrEqual(1)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    })
    expect(after.status).toBe('CANCELLED')

    const released = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true },
    })
    expect(released.status).toBe('AVAILABLE')
  })

  it('laisse tranquille une commande récente', async () => {
    const article = await makeArticle('c2')
    const order = await makeOrder('202', [article.id])

    await expireStaleOrders(120)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    })
    expect(after.status).toBe('PENDING_PAYMENT')

    // Et sa pièce reste réservée : quelqu'un est peut-être devant son
    // formulaire de carte à cet instant.
    const still = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true },
    })
    expect(still.status).toBe('RESERVED')
  })

  it('ne touche pas à une commande déjà payée, même ancienne', async () => {
    const article = await makeArticle('c3')
    const order = await makeOrder('203', [article.id])
    await markOrderPaid({ orderId: order.id, paymentIntentId: 'pi_9', paidAt: PAID_AT })
    await prisma.order.update({
      where: { id: order.id },
      data: { createdAt: new Date(Date.now() - 30 * 24 * 3_600_000) },
    })

    await expireStaleOrders(120)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    })
    expect(after.status).toBe('PAID')
  })
})

describe('paiement arrivé après une annulation', () => {
  it('rouvre la commande plutôt que d’encaisser dans le vide', async () => {
    // Stripe ne garantit pas l'ordre des événements. Si un paiement arrive
    // après que le balayage a annulé la commande, refuser reviendrait à
    // encaisser sans qu'aucune commande n'existe — le pire des états, parce
    // qu'il est invisible.
    const article = await makeArticle('d1')
    const order = await makeOrder('301', [article.id])

    expect(await expireOrder(order.id)).toBe(true)

    const result = await markOrderPaid({
      orderId: order.id,
      paymentIntentId: 'pi_10',
      paidAt: PAID_AT,
    })

    expect(result.applied).toBe(true)
    expect(result.soldArticleIds).toEqual([article.id])

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, cancelledAt: true },
    })
    expect(after.status).toBe('PAID')
    // L'historique ne doit pas dire à la fois « payée » et « annulée ».
    expect(after.cancelledAt).toBeNull()
  })
})
