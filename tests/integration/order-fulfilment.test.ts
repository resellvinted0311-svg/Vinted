import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type { OrderStatus } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { advanceOrder } from '@/lib/shop/fulfilment'
import {
  listOrdersToFulfil,
  countOrdersToFulfil,
  getOrderForFulfilment,
} from '@/lib/db/queries/admin-orders'
import { anonymizeUser, anonymizeExpiredOrders } from '@/lib/privacy/anonymize'
import { exportPersonalData } from '@/lib/privacy/export'

/**
 * Expédier une commande, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Ce que seule une base peut dire
 * ---------------------------------------------------------------------------
 * Que la transition est bien CONDITIONNELLE — donc qu'un second clic ne
 * réécrit rien et n'inscrit pas un second avis d'expédition ; que la ligne
 * `Shipment` est créée avec le bon poids ; et que le numéro de suivi s'efface
 * réellement à l'effacement du compte, ce qui est une promesse publiée sur la
 * page de confidentialité.
 *
 * ---------------------------------------------------------------------------
 * Le jeu de données de développement est PARTAGÉ
 * ---------------------------------------------------------------------------
 * D'autres suites — et les exécutions Playwright — y laissent des commandes.
 * Chaque assertion de comptage est donc bornée au préfixe de ce fichier :
 * compter toutes les commandes à expédier de la base rendrait ce test vert ou
 * rouge selon ce qui a tourné avant lui.
 */

const PREFIX = 'EXPED-'

async function cleanup(): Promise<void> {
  await prisma.shipment.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({
    where: { email: { startsWith: 'exped-' } },
  })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(suffix: string, weightGrams = 400) {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  return prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `exped-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 2000,
      costCents: 600,
      floorPriceCents: 1200,
      weightGrams,
      status: 'SOLD',
      soldAt: new Date(),
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })
}

async function makeOrder(
  suffix: string,
  {
    status = 'PAID',
    paidAt = new Date('2026-08-01T10:00:00.000Z'),
    weightGrams = 400,
    userId = null,
  }: {
    status?: OrderStatus
    paidAt?: Date | null
    weightGrams?: number
    userId?: string | null
  } = {},
) {
  const article = await makeArticle(suffix, weightGrams)

  return prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      userId,
      email: 'acheteuse@exemple.fr',
      locale: 'fr',
      status,
      paidAt,
      subtotalCents: 2000,
      shippingCents: 490,
      totalCents: 2490,
      shippingAddress: {
        firstName: 'Camille',
        lastName: 'Roy',
        line1: '12 rue des Arts',
        postalCode: '59000',
        city: 'Lille',
        country: 'FR',
      },
      billingAddress: { city: 'Lille' },
      shippingCarrierCode: 'mock',
      shippingServiceCode: 'standard',
      items: {
        create: {
          articleId: article.id,
          titleSnapshot: 'Pull en laine',
          imageSnapshot: '',
          unitPriceCents: 2000,
          costCentsSnapshot: 600,
        },
      },
    },
    select: { id: true, orderNumber: true },
  })
}

/** Promesse dénouée de l'extérieur, pour entrelacer deux transactions à la main. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Ne regarde que les commandes de ce fichier — la base est partagée. */
function mine<T extends { orderNumber: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.orderNumber.startsWith(PREFIX))
}

describe('avancer une commande', () => {
  it('passe de payée à expédiée et date l’expédition', async () => {
    const order = await makeOrder('001')

    const result = await advanceOrder({ orderId: order.id, action: 'ship' })

    expect(result).toEqual({ ok: true, status: 'SHIPPED' })

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, shippedAt: true, deliveredAt: true },
    })
    expect(after.status).toBe('SHIPPED')
    // Le trou que ce lot vient combler : rien n'écrivait jamais cette date.
    expect(after.shippedAt).not.toBeNull()
    expect(after.deliveredAt).toBeNull()
  })

  it('refuse le second clic sans rien réécrire', async () => {
    const order = await makeOrder('002')

    await advanceOrder({ orderId: order.id, action: 'ship' })
    const first = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { shippedAt: true },
    })

    const again = await advanceOrder({ orderId: order.id, action: 'ship' })

    expect(again).toEqual({ ok: false, reason: 'invalid-transition' })

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { shippedAt: true },
    })
    // La date reste celle du premier geste : un second passage l'écraserait
    // avec l'heure du clic, et l'acheteuse verrait sa commande « repartir ».
    expect(after.shippedAt).toEqual(first.shippedAt)

    // Et surtout : un seul avis d'expédition inscrit, pas deux.
    const jobs = await prisma.job.count({
      where: { type: 'order.shipped', payload: { path: ['orderId'], equals: order.id } },
    })
    expect(jobs).toBe(1)
  })

  it('n’écrit rien si l’état a changé entre la lecture et l’écriture', async () => {
    // ------------------------------------------------------------------
    // Le test qui manquait, et pourquoi les précédents ne suffisaient pas
    // ------------------------------------------------------------------
    // « Refuse le second clic » est SÉQUENTIEL : le premier appel a commité
    // avant que le second ne lise, donc `planTransition` refuse dès la lecture
    // et l'écriture n'est jamais tentée. Vérifié par mutation : retirer le
    // prédicat `AND "status" = <l'état lu>` de l'UPDATE laissait ce test-là
    // vert. Il mesure le garde du DOMAINE, pas celui de la base — et deux
    // `advanceOrder` lancés ensemble ne font pas mieux : Prisma les sérialise
    // assez souvent pour que le second lise déjà l'état écrit par le premier.
    //
    // On force donc l'entrelacement, comme `stock-lock.test.ts` le fait pour
    // le verrou de stock. Une transaction tierce tient le verrou de ligne
    // pendant qu'`advanceOrder` lit ; elle écrit EXPÉDIÉE et commite pendant
    // qu'`advanceOrder` est bloquée sur son UPDATE. Au réveil, en lecture
    // validée, PostgreSQL réévalue la clause : `status = 'PAID'` ne correspond
    // plus.
    //
    // Sans le prédicat, l'UPDATE passerait quand même — et un SECOND avis
    // d'expédition partirait pour un seul colis.
    const order = await makeOrder('006')

    const verrouPris = deferred()
    const laisserPasser = deferred()

    const intruse = prisma.$transaction(
      async (tx) => {
        // `FOR UPDATE` prend le verrou de ligne sans empêcher la lecture
        // simple d'`advanceOrder` : c'est exactement la fenêtre à reproduire.
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`
        verrouPris.resolve()
        await laisserPasser.promise
        await tx.$executeRaw`
          UPDATE "Order" SET "status" = 'SHIPPED', "shippedAt" = now() WHERE "id" = ${order.id}
        `
      },
      { timeout: 15_000 },
    )

    await verrouPris.promise

    const bloquee = advanceOrder({ orderId: order.id, action: 'ship' })

    // Le temps qu'`advanceOrder` lise PAYÉE puis vienne buter sur le verrou.
    await new Promise((resolve) => setTimeout(resolve, 300))
    laisserPasser.resolve()
    await intruse

    expect(await bloquee).toEqual({ ok: false, reason: 'invalid-transition' })

    const jobs = await prisma.job.count({
      where: {
        type: 'order.shipped',
        payload: { path: ['orderId'], equals: order.id },
      },
    })
    expect(jobs, 'un seul colis, aucun avis en double').toBe(0)
  })

  it('refuse d’expédier une commande annulée', async () => {
    const order = await makeOrder('003', { status: 'CANCELLED', paidAt: null })

    const result = await advanceOrder({ orderId: order.id, action: 'ship' })

    expect(result).toEqual({ ok: false, reason: 'invalid-transition' })

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, shippedAt: true },
    })
    expect(after.status).toBe('CANCELLED')
    expect(after.shippedAt).toBeNull()
  })

  it('refuse de reculer une commande livrée', async () => {
    const order = await makeOrder('004', { status: 'DELIVERED' })

    expect(await advanceOrder({ orderId: order.id, action: 'prepare' })).toEqual({
      ok: false,
      reason: 'invalid-transition',
    })
    expect(await advanceOrder({ orderId: order.id, action: 'ship' })).toEqual({
      ok: false,
      reason: 'invalid-transition',
    })
  })

  it('dit qu’elle ne trouve pas plutôt que d’échouer', async () => {
    expect(
      await advanceOrder({ orderId: 'commande-inexistante', action: 'ship' }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })

  it('suit le parcours complet, préparation comprise', async () => {
    const order = await makeOrder('005')

    expect(await advanceOrder({ orderId: order.id, action: 'prepare' })).toEqual({
      ok: true,
      status: 'PREPARING',
    })
    expect(await advanceOrder({ orderId: order.id, action: 'ship' })).toEqual({
      ok: true,
      status: 'SHIPPED',
    })
    expect(await advanceOrder({ orderId: order.id, action: 'deliver' })).toEqual({
      ok: true,
      status: 'DELIVERED',
    })

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, shippedAt: true, deliveredAt: true },
    })
    expect(after.status).toBe('DELIVERED')
    // Les deux dates coexistent : marquer la livraison ne doit pas effacer la
    // date d'expédition, que la facture et le suivi affichent.
    expect(after.shippedAt).not.toBeNull()
    expect(after.deliveredAt).not.toBeNull()
  })
})

describe('la ligne d’expédition', () => {
  it('n’est créée que si un numéro de suivi est saisi', async () => {
    const order = await makeOrder('010')

    await advanceOrder({ orderId: order.id, action: 'ship' })

    const shipments = await prisma.shipment.count({ where: { orderId: order.id } })
    // Toutes les expéditions n'ont pas de numéro. Créer une ligne vide
    // afficherait « suivi disponible » sur un envoi qui n'en a pas.
    expect(shipments).toBe(0)
  })

  it('normalise le numéro recopié du bordereau et pèse le colis', async () => {
    const order = await makeOrder('011', { weightGrams: 620 })

    await advanceOrder({
      orderId: order.id,
      action: 'ship',
      tracking: { number: '6a 1234 5678 9', url: 'https://suivi.example/6a' },
    })

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: order.id },
      select: {
        trackingNumber: true,
        trackingUrl: true,
        weightGrams: true,
        provider: true,
        carrierCode: true,
        status: true,
      },
    })

    // Espaces retirés, capitales : un suivi qui porte deux espaces ne
    // correspond à rien chez le transporteur.
    expect(shipment.trackingNumber).toBe('6A123456789')
    expect(shipment.trackingUrl).toBe('https://suivi.example/6a')
    // Aucun transporteur branché : le dire évite qu'on cherche plus tard un
    // appel d'API qui n'a jamais eu lieu.
    expect(shipment.provider).toBe('manual')
    expect(shipment.carrierCode).toBe('mock')
    expect(shipment.status).toBe('shipped')
    // Contenu + emballage, comme le devis l'avait calculé. Le poids du contenu
    // seul serait un colis plus léger que celui qu'on remet au transporteur.
    expect(shipment.weightGrams).toBeGreaterThan(620)
  })
})

describe('la file des commandes à expédier', () => {
  it('ne retient que ce qui attend un geste', async () => {
    await makeOrder('020', { status: 'PAID' })
    await makeOrder('021', { status: 'PREPARING' })
    await makeOrder('022', { status: 'SHIPPED' })
    await makeOrder('023', { status: 'CANCELLED', paidAt: null })
    await makeOrder('024', { status: 'PENDING_PAYMENT', paidAt: null })

    const numbers = mine(await listOrdersToFulfil()).map((row) => row.orderNumber)

    expect(numbers.sort()).toEqual([`${PREFIX}020`, `${PREFIX}021`])
  })

  it('met la plus ancienne en tête', async () => {
    // L'inverse du réflexe, et c'est délibéré : trier par nouveauté ferait
    // expédier la commande d'il y a dix minutes avant celle d'avant-hier.
    await makeOrder('031', { paidAt: new Date('2026-08-10T09:00:00.000Z') })
    await makeOrder('030', { paidAt: new Date('2026-08-02T09:00:00.000Z') })
    await makeOrder('032', { paidAt: new Date('2026-08-20T09:00:00.000Z') })

    const numbers = mine(await listOrdersToFulfil()).map((row) => row.orderNumber)

    expect(numbers).toEqual([`${PREFIX}030`, `${PREFIX}031`, `${PREFIX}032`])
  })

  it('donne l’adresse en lignes postales et les gestes possibles', async () => {
    await makeOrder('040', { status: 'PREPARING' })

    const entries = mine(await listOrdersToFulfil())
    // Une liste vide ferait passer les assertions suivantes sur `undefined`
    // sans rien vérifier : on exige d'abord qu'il y ait quelque chose à lire.
    expect(entries).toHaveLength(1)
    const entry = entries[0]!

    expect(entry.addressLines).toEqual([
      'Camille Roy',
      '12 rue des Arts',
      '59000 Lille',
      'FR',
    ])
    expect(entry.destination).toEqual({ city: 'Lille', country: 'FR' })
    // Depuis « en préparation », seul « expédier » est possible : proposer
    // « mettre en préparation » ferait cliquer sur un bouton qui échoue.
    expect(entry.actions).toEqual(['ship'])
  })

  it('compte la même chose que ce qu’elle liste', async () => {
    const avant = await countOrdersToFulfil()
    await makeOrder('050', { status: 'PAID' })
    await makeOrder('051', { status: 'SHIPPED' })

    // Une seule des deux attend un geste : le compteur du tableau de bord et
    // la file doivent dire le même nombre, sans quoi la pastille annonce du
    // travail qui n'apparaît nulle part.
    expect(await countOrdersToFulfil()).toBe(avant + 1)
  })

  it('retrouve une commande sortie de la file, pour constater la livraison', async () => {
    const order = await makeOrder('060', { status: 'SHIPPED' })

    const entry = await getOrderForFulfilment(order.orderNumber)

    expect(entry?.actions).toEqual(['deliver'])
    expect(mine(await listOrdersToFulfil())).toEqual([])
  })
})

describe('le numéro de suivi et la vie privée', () => {
  async function makeAccountOrder(suffix: string) {
    const user = await prisma.user.create({
      data: { email: `exped-${suffix}@exemple.fr`, locale: 'fr' },
      select: { id: true, email: true },
    })
    const order = await makeOrder(suffix, { userId: user.id })

    await advanceOrder({
      orderId: order.id,
      action: 'ship',
      tracking: { number: 'LA123456789FR', url: 'https://suivi.example/la' },
    })

    return { user, order }
  }

  it('figure dans la copie remise au titre de l’article 15', async () => {
    const { user } = await makeAccountOrder('070')

    const bundle = (await exportPersonalData(user.id)) as {
      orders: { shipments?: { trackingNumber: string | null }[] }[]
    }

    const numeros = bundle.orders.flatMap((order) =>
      (order.shipments ?? []).map((shipment) => shipment.trackingNumber),
    )
    // Un numéro de suivi ouvre chez le transporteur une page qui porte la
    // destination du colis : c'est un identifiant indirect, et la copie doit
    // le contenir.
    expect(numeros).toContain('LA123456789FR')
  })

  it('s’efface avec le compte, sans emporter la ligne comptable', async () => {
    const { user, order } = await makeAccountOrder('071')

    await anonymizeUser(user.id)

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: order.id },
      select: { trackingNumber: true, trackingUrl: true, weightGrams: true },
    })

    // Le défaut évité : effacer l'adresse de la commande d'un côté et garder,
    // de l'autre, la clé qui l'ouvre chez le transporteur.
    expect(shipment.trackingNumber).toBeNull()
    expect(shipment.trackingUrl).toBeNull()
    // La ligne reste : poids et transporteur expliquent un coût de port porté
    // sur une pièce comptable, et n'ont rien de personnel.
    expect(shipment.weightGrams).toBeGreaterThan(0)
  })

  it('s’efface aussi à l’échéance comptable, sans compte', async () => {
    const order = await makeOrder('072', {
      paidAt: new Date('2014-01-01T00:00:00.000Z'),
    })
    await advanceOrder({
      orderId: order.id,
      action: 'ship',
      tracking: { number: 'LA987654321FR' },
    })

    await anonymizeExpiredOrders(new Date('2026-01-01T00:00:00.000Z'))

    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: order.id },
      select: { trackingNumber: true },
    })
    expect(shipment.trackingNumber).toBeNull()
  })
})
