import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import { markOrderPaid } from '@/lib/shop/fulfilment'
import { releaseExpiredStockLocks, releaseStockLocks } from '@/lib/shop/stock-lock'
import { runSyncNotify, signSyncPayload } from '@/lib/sync/webhook'
import { enqueueSyncEvents } from '@/lib/sync/outbound'

/**
 * La remontée des ventes vers l'application de gestion, contre une vraie base.
 *
 * Deux questions, et elles ne se simulent pas :
 *
 *  - une vente encaissée inscrit-elle RÉELLEMENT sa remontée, dans la même
 *    transaction, et seulement pour les pièces que l'application connaît ?
 *  - le corps qui part contient-il ce que le contrat annonce, et RIEN de plus —
 *    en particulier aucune donnée personnelle ?
 *
 * Seul l'appel réseau est simulé. Tout le reste — transaction, filtrage,
 * répartition des montants, signature — est exercé pour de vrai.
 */

const PREFIX = 'SYNCOUT-'
const SECRET = 'secret-de-remontee-Ai9x3kQm2ZpL'
const URL = 'https://application.test/api/webhooks/boutique'

/** Données personnelles de l'acheteuse. Aucune ne doit sortir. */
const BUYER = {
  email: 'acheteuse.privee@exemple.fr',
  firstName: 'Nina',
  lastName: 'Dupont-Exemple',
  line1: '12 rue du Registre',
  postalCode: '59000',
  city: 'Lille',
  country: 'FR',
}

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({})
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

/**
 * Une pièce du catalogue.
 *
 * `externalId` est le pivot : sans lui, la pièce est née ici et l'application
 * ne la connaît pas. C'est exactement la distinction que ces tests vérifient.
 */
async function makeArticle(
  suffix: string,
  options: { externalId?: string | null; priceCents?: number } = {},
): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({
    select: { id: true },
  })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `syncout-${suffix}`,
      externalId:
        options.externalId === undefined
          ? `${PREFIX}ext-${suffix}`
          : options.externalId,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: options.priceCents ?? 3800,
      costCents: 900,
      floorPriceCents: 2340,
      weightGrams: 320,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })

  return article.id
}

async function makeOrder(
  suffix: string,
  articleIds: readonly string[],
  amounts: { unitPriceCents: number[]; shippingCents: number },
): Promise<string> {
  const subtotal = amounts.unitPriceCents.reduce((a, b) => a + b, 0)

  const order = await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      email: BUYER.email,
      locale: 'fr',
      status: 'PENDING_PAYMENT',
      subtotalCents: subtotal,
      shippingCents: amounts.shippingCents,
      shippingCostCents: 480,
      totalCents: subtotal + amounts.shippingCents,
      shippingAddress: {
        firstName: BUYER.firstName,
        lastName: BUYER.lastName,
        line1: BUYER.line1,
        postalCode: BUYER.postalCode,
        city: BUYER.city,
        country: BUYER.country,
      },
      billingAddress: {},
      shippingCarrierCode: 'colissimo',
      shippingServiceCode: 'COL_HOME',
      items: {
        create: articleIds.map((articleId, index) => ({
          articleId,
          titleSnapshot: 'Chemise',
          imageSnapshot: '',
          unitPriceCents: amounts.unitPriceCents[index] ?? 0,
          costCentsSnapshot: 900,
        })),
      },
    },
    select: { id: true },
  })

  return order.id
}

function syncJobs() {
  return prisma.job.findMany({
    where: { type: 'sync.notify' },
    orderBy: { createdAt: 'asc' },
    select: { payload: true },
  })
}

beforeEach(async () => {
  await cleanup()
  vi.stubEnv('SYNC_WEBHOOK_URL', URL)
  vi.stubEnv('SYNC_WEBHOOK_SECRET', SECRET)
})

afterAll(async () => {
  await cleanup()
  vi.unstubAllEnvs()
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Ce qui déclenche une remontée
// ---------------------------------------------------------------------------

describe('inscription des remontées', () => {
  it('une vente encaissée inscrit sa remontée', async () => {
    const articleId = await makeArticle('a1')
    const orderId = await makeOrder('a1', [articleId], {
      unitPriceCents: [3800],
      shippingCents: 0,
    })

    const paidAt = new Date('2026-08-14T10:32:11.000Z')
    const result = await markOrderPaid({
      orderId,
      paymentIntentId: 'pi_test',
      paidAt,
    })
    expect(result.applied).toBe(true)

    const jobs = await syncJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toMatchObject({
      event: 'article.sold',
      articleId,
      // L'instant du FAIT, pas celui de l'envoi : c'est la clé d'idempotence
      // de l'autre côté, et elle ne doit pas changer d'une reprise à l'autre.
      occurredAt: paidAt.toISOString(),
      orderId,
    })
  })

  it('ignore les pièces que l’application ne connaît pas', async () => {
    // Née en back-office ou dans le jeu de démonstration : lui annoncer la
    // vente d'un identifiant que l'application n'a jamais émis ne peut
    // produire qu'une erreur de son côté.
    const articleId = await makeArticle('a2', { externalId: null })
    const orderId = await makeOrder('a2', [articleId], {
      unitPriceCents: [3800],
      shippingCents: 0,
    })

    await markOrderPaid({ orderId, paymentIntentId: null, paidAt: new Date() })

    expect(await syncJobs()).toHaveLength(0)
  })

  it('n’inscrit rien quand la destination n’est pas configurée', async () => {
    // Sinon une boutique dont l'application n'est pas branchée accumulerait
    // deux travaux morts par vente, abandonnés après six échecs chacun.
    vi.stubEnv('SYNC_WEBHOOK_URL', '')

    const articleId = await makeArticle('a3')
    const orderId = await makeOrder('a3', [articleId], {
      unitPriceCents: [3800],
      shippingCents: 0,
    })

    await markOrderPaid({ orderId, paymentIntentId: null, paidAt: new Date() })

    expect(await syncJobs()).toHaveLength(0)
  })

  it('ne remonte que les pièces RÉELLEMENT libérées', async () => {
    const mine = await makeArticle('a4')
    const theirs = await makeArticle('a5')

    // Statut, propriétaire et échéance en une seule écriture : la base porte
    // une contrainte `Article_reservation_coherent` qui refuse un verrou sans
    // propriétaire ni date. La poser en deux temps échouerait — et c'est très
    // bien ainsi, puisque cet état intermédiaire ne devrait jamais exister.
    await prisma.article.update({
      where: { id: mine },
      data: {
        status: 'RESERVED',
        reservedById: 'moi',
        reservedUntil: new Date(Date.now() + 15 * 60_000),
      },
    })
    await prisma.article.update({
      where: { id: theirs },
      data: {
        status: 'RESERVED',
        reservedById: 'quelqu-un-d-autre',
        reservedUntil: new Date(Date.now() + 15 * 60_000),
      },
    })

    const released = await prisma.$transaction((tx) =>
      releaseStockLocks(tx, { articleIds: [mine, theirs], ownerId: 'moi' }),
    )

    expect(released).toBe(1)

    // Annoncer la libération de la pièce d'un autre la remettrait en vente
    // dans l'inventaire d'en face, au moment exact où quelqu'un la paie ici.
    const jobs = await syncJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toMatchObject({
      event: 'article.released',
      articleId: mine,
    })
  })

  it('le balayage des réservations échues remonte ce qu’il libère', async () => {
    const articleId = await makeArticle('a6')
    await prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'RESERVED',
        reservedById: 'panier-abandonne',
        reservedUntil: new Date(Date.now() - 60_000),
      },
    })

    const count = await releaseExpiredStockLocks()
    expect(count).toBe(1)

    const jobs = await syncJobs()
    expect(jobs.some((job) => (job.payload as { articleId?: string }).articleId === articleId)).toBe(
      true,
    )
  })

  it('n’inscrit rien deux fois pour la même pièce d’un même lot', async () => {
    const articleId = await makeArticle('a7')

    await prisma.$transaction((tx) =>
      enqueueSyncEvents(tx, {
        event: 'article.reserved',
        articleIds: [articleId, articleId],
        occurredAt: new Date(),
      }),
    )

    expect(await syncJobs()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Ce qui part réellement
// ---------------------------------------------------------------------------

describe('corps envoyé', () => {
  function captureFetch() {
    const sent: { url: string; headers: Headers; body: string }[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init: RequestInit) => {
        sent.push({
          url: String(url),
          headers: new Headers(init.headers),
          body: String(init.body),
        })
        return new Response(null, { status: 204 })
      }),
    )

    return sent
  }

  it('porte ce que le contrat annonce, et le signe', async () => {
    const articleId = await makeArticle('b1')
    const orderId = await makeOrder('b1', [articleId], {
      unitPriceCents: [3800],
      shippingCents: 0,
    })

    const paidAt = new Date('2026-08-14T10:32:11.000Z')
    await markOrderPaid({ orderId, paymentIntentId: null, paidAt })

    const sent = captureFetch()
    const [job] = await syncJobs()
    expect(await runSyncNotify(job?.payload)).toBe(true)

    expect(sent).toHaveLength(1)
    const call = sent[0]
    if (!call) throw new Error('aucun appel capturé')

    expect(call.url).toBe(URL)

    const body = JSON.parse(call.body) as Record<string, unknown>
    expect(body.event).toBe('article.sold')
    expect(body.externalId).toBe(`${PREFIX}ext-b1`)
    expect(body.sku).toBe(`${PREFIX}b1`)
    expect(body.occurredAt).toBe(paidAt.toISOString())

    // 1,50 % + 25 centimes sur 3800 : 57 + 25 = 82. Le chiffre du contrat.
    expect(body.sale).toMatchObject({
      priceCents: 3800,
      shippingPaidCents: 0,
      paymentFeeCents: 82,
      netCents: 3718,
      orderLineCount: 1,
    })

    // De quoi réconcilier les poids : 320 g de pièce, 80 g d'emballage, et le
    // palier de 500 g qui les couvre. C'est en comparant les deux derniers que
    // l'application voit qu'une pièce frôle une borne — là où une sous-
    // estimation de poids coûte un palier entier à chaque vente.
    expect(body.shipping).toEqual({
      parcelWeightGrams: 400,
      tierMaxGrams: 500,
      carrierCostCents: 480,
      chargedCents: 0,
    })

    const timestamp = call.headers.get('x-nd-timestamp')
    expect(timestamp).toMatch(/^\d+$/)

    // La signature porte sur `<horodatage>.<corps brut>` — la chaîne EXACTE
    // qui part sur le réseau. Signer un objet puis le re-sérialiser à l'envoi
    // signerait autre chose que ce qui est transmis.
    const expected = createHmac('sha256', SECRET)
      .update(`${timestamp}.${call.body}`)
      .digest('hex')
    expect(call.headers.get('x-nd-signature')).toBe(`sha256=${expected}`)
  })

  it('ne porte AUCUNE donnée personnelle', async () => {
    const articleId = await makeArticle('b2')
    const orderId = await makeOrder('b2', [articleId], {
      unitPriceCents: [3800],
      shippingCents: 590,
    })
    await markOrderPaid({ orderId, paymentIntentId: null, paidAt: new Date() })

    const sent = captureFetch()
    const [job] = await syncJobs()
    await runSyncNotify(job?.payload)

    const raw = sent[0]?.body ?? ''

    // Une application de suivi d'inventaire n'a pas besoin de savoir QUI a
    // acheté. Transmettre davantage en ferait un destinataire de données
    // personnelles : à déclarer, à contractualiser, à sécuriser.
    for (const secret of Object.values(BUYER)) {
      expect(raw, `« ${secret} » ne doit pas sortir`).not.toContain(secret)
    }
    // Ni l'identifiant de commande, qui permettrait de recouper deux ventes
    // faites par la même personne.
    expect(raw).not.toContain(orderId)
  })

  it('répartit port et commission sur une commande à plusieurs pièces', async () => {
    const first = await makeArticle('b3')
    const second = await makeArticle('b4')
    const orderId = await makeOrder('b3', [first, second], {
      unitPriceCents: [3000, 1000],
      shippingCents: 590,
    })
    await markOrderPaid({ orderId, paymentIntentId: null, paidAt: new Date() })

    const sent = captureFetch()
    for (const job of await syncJobs()) await runSyncNotify(job.payload)

    const bodies = sent.map(
      (call) => JSON.parse(call.body) as { sale: Record<string, number> },
    )
    expect(bodies).toHaveLength(2)

    const shipping = bodies.map((body) => body.sale.shippingPaidCents ?? 0)
    const fees = bodies.map((body) => body.sale.paymentFeeCents ?? 0)

    // Les parts font exactement le tout : une répartition qui dérive d'un
    // centime par commande fausse une comptabilité entière à la longue.
    expect(shipping.reduce((a, b) => a + b, 0)).toBe(590)
    expect(fees.reduce((a, b) => a + b, 0)).toBe(
      // 1,50 % de 4590 arrondi au centime supérieur, plus 25.
      Math.ceil((4590 * 150) / 10_000) + 25,
    )

    // Et chacun sait qu'il s'agit d'une part.
    for (const body of bodies) expect(body.sale.orderLineCount).toBe(2)
  })

  it('lève sur une réponse qui n’est pas un 2xx', async () => {
    const articleId = await makeArticle('b5')
    const orderId = await makeOrder('b5', [articleId], {
      unitPriceCents: [3800],
      shippingCents: 0,
    })
    await markOrderPaid({ orderId, paymentIntentId: null, paidAt: new Date() })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    )

    const [job] = await syncJobs()

    // Lever EST le mécanisme de reprise : la file diffère et rejoue selon
    // l'échelle annoncée au contrat.
    await expect(runSyncNotify(job?.payload)).rejects.toThrow(/500/)
  })

  it('classe sans réessayer une pièce détachée de l’application', async () => {
    const articleId = await makeArticle('b6')
    await prisma.$transaction((tx) =>
      enqueueSyncEvents(tx, {
        event: 'article.released',
        articleIds: [articleId],
        occurredAt: new Date(),
      }),
    )

    // L'application a repris la main : la pièce n'est plus la sienne.
    await prisma.article.update({
      where: { id: articleId },
      data: { externalId: null },
    })

    const sent = captureFetch()
    const [job] = await syncJobs()

    expect(await runSyncNotify(job?.payload)).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('refuse d’envoyer en clair', async () => {
    vi.stubEnv('SYNC_WEBHOOK_URL', 'http://application.test/webhook')

    const articleId = await makeArticle('b7')
    await prisma.$transaction((tx) =>
      enqueueSyncEvents(tx, {
        event: 'article.released',
        articleIds: [articleId],
        occurredAt: new Date(),
      }),
    )

    const sent = captureFetch()
    const [job] = await syncJobs()

    // Le corps ne porte pas de données personnelles, mais il porte des montants
    // et une signature : en clair, les deux se lisent et se rejouent.
    await expect(runSyncNotify(job?.payload)).rejects.toThrow(/https/)
    expect(sent).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

describe('signature', () => {
  it('change avec l’horodatage, à corps identique', () => {
    const body = '{"event":"article.sold"}'

    // Sans l'horodatage DANS le message signé, un appel intercepté resterait
    // valable indéfiniment : sa signature ne dépendrait que d'un corps qui ne
    // change pas.
    expect(signSyncPayload(body, 1_755_168_000, SECRET)).not.toBe(
      signSyncPayload(body, 1_755_168_060, SECRET),
    )
  })

  it('change avec le corps, à horodatage identique', () => {
    expect(signSyncPayload('{"a":1}', 1_755_168_000, SECRET)).not.toBe(
      signSyncPayload('{"a":2}', 1_755_168_000, SECRET),
    )
  })

  it('change avec le secret', () => {
    expect(signSyncPayload('{"a":1}', 1_755_168_000, SECRET)).not.toBe(
      signSyncPayload('{"a":1}', 1_755_168_000, `${SECRET}x`),
    )
  })
})
