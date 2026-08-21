import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { prisma } from '@/lib/db/client'
import { POST } from '@/app/api/webhooks/stripe/route'
import { __resetStripeClientForTests } from '@/lib/payments/stripe'

/**
 * Le webhook est la SEULE autorité sur « c'est payé ».
 *
 * La page de retour de Stripe est une redirection du navigateur : n'importe
 * qui peut l'ouvrir à la main. Si cette route se laissait tromper, on
 * distribuerait des vêtements à qui sait fabriquer une requête POST.
 *
 * La signature est vérifiée par une fonction locale (HMAC sur le corps brut) :
 * ces tests n'appellent aucun serveur Stripe.
 */

const WEBHOOK_SECRET = 'whsec_test_secret_pour_signature_locale'
const PREFIX = 'HOOK-'

let savedKey: string | undefined
let savedHook: string | undefined

beforeAll(() => {
  savedKey = process.env.STRIPE_SECRET_KEY
  savedHook = process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_SECRET_KEY = 'sk_test_factice'
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  __resetStripeClientForTests()
})

afterAll(async () => {
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = savedKey
  if (savedHook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
  else process.env.STRIPE_WEBHOOK_SECRET = savedHook

  __resetStripeClientForTests()
  await cleanup()
  await prisma.$disconnect()
})

async function cleanup(): Promise<void> {
  await prisma.webhookEvent.deleteMany({
    where: { externalId: { startsWith: 'evt_test_' } },
  })
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

beforeEach(cleanup)

async function makeOrderWithArticle(suffix: string) {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `hook-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 3000,
      costCents: 900,
      floorPriceCents: 1500,
      weightGrams: 500,
      status: 'RESERVED',
      reservedById: 'jeton-test',
      reservedUntil: new Date(Date.now() + 900_000),
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })

  const order = await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      email: 'acheteuse@exemple.fr',
      locale: 'fr',
      status: 'PENDING_PAYMENT',
      subtotalCents: 3000,
      shippingCents: 490,
      totalCents: 3490,
      shippingAddress: { city: 'Lille' },
      billingAddress: { city: 'Lille' },
      shippingCarrierCode: 'mock',
      shippingServiceCode: 'standard',
      items: {
        create: [
          {
            articleId: article.id,
            titleSnapshot: 'Manteau',
            imageSnapshot: '',
            unitPriceCents: 3000,
            costCentsSnapshot: 900,
          },
        ],
      },
    },
    select: { id: true },
  })

  return { orderId: order.id, articleId: article.id }
}

/** Construit un événement signé exactement comme Stripe le fait. */
function signedRequest(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event)
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret })

  return new NextRequest('https://exemple.test/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
  })
}

function completedEvent(input: {
  id: string
  orderId: string
  paymentStatus?: string
  created?: number
}) {
  return {
    id: input.id,
    object: 'event',
    api_version: '2026-07-29.dahlia',
    created: input.created ?? 1_755_770_400,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${input.id}`,
        object: 'checkout.session',
        payment_status: input.paymentStatus ?? 'paid',
        payment_intent: `pi_test_${input.id}`,
        client_reference_id: input.orderId,
        metadata: { orderId: input.orderId },
      },
    },
  }
}

describe('signature', () => {
  it('refuse une requête sans signature', async () => {
    const request = new NextRequest('https://exemple.test/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('refuse une signature fabriquée avec un autre secret', async () => {
    const { orderId } = await makeOrderWithArticle('sig1')
    const request = signedRequest(
      completedEvent({ id: 'evt_test_sig1', orderId }),
      'whsec_le_mauvais_secret',
    )

    const response = await POST(request)
    expect(response.status).toBe(400)

    // Et surtout : rien n'a été traité.
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })
    expect(order.status).toBe('PENDING_PAYMENT')
  })

  it('refuse un corps modifié après signature', async () => {
    const { orderId } = await makeOrderWithArticle('sig2')
    const event = completedEvent({ id: 'evt_test_sig2', orderId })
    const payload = JSON.stringify(event)
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    })

    // La signature couvre les octets exacts. Un seul caractère change, et elle
    // ne vaut plus rien — c'est précisément pourquoi le corps est lu en brut.
    const tampered = payload.replace('"paid"', '"unpaid"')

    const response = await POST(
      new NextRequest('https://exemple.test/api/webhooks/stripe', {
        method: 'POST',
        body: tampered,
        headers: { 'stripe-signature': header },
      }),
    )

    expect(response.status).toBe(400)
  })

  it('refuse tout si le secret n’est pas configuré', async () => {
    const { orderId } = await makeOrderWithArticle('sig3')
    delete process.env.STRIPE_WEBHOOK_SECRET

    const response = await POST(
      signedRequest(completedEvent({ id: 'evt_test_sig3', orderId })),
    )

    // 500 et non 200 : Stripe doit réessayer une fois la variable posée,
    // plutôt que de considérer l'événement comme reçu et le perdre.
    expect(response.status).toBe(500)

    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  })
})

describe('paiement confirmé', () => {
  it('marque la commande payée et la pièce vendue', async () => {
    const { orderId, articleId } = await makeOrderWithArticle('ok1')

    const response = await POST(
      signedRequest(completedEvent({ id: 'evt_test_ok1', orderId })),
    )
    expect(response.status).toBe(200)

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, paidAt: true, stripePaymentIntentId: true },
    })
    expect(order.status).toBe('PAID')
    expect(order.stripePaymentIntentId).toBe('pi_test_evt_test_ok1')
    // L'horodatage vient de l'événement, pas de l'horloge du serveur.
    expect(order.paidAt?.toISOString()).toBe(
      new Date(1_755_770_400 * 1000).toISOString(),
    )

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('SOLD')
  })

  it('rejoué, ne traite pas deux fois', async () => {
    const { orderId } = await makeOrderWithArticle('ok2')
    const event = completedEvent({ id: 'evt_test_ok2', orderId })

    await POST(signedRequest(event))
    const replay = await POST(signedRequest(event))

    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ duplicate: true })

    expect(
      await prisma.webhookEvent.count({ where: { externalId: 'evt_test_ok2' } }),
    ).toBe(1)
  })

  it('reprend un événement dont le traitement avait été interrompu', async () => {
    // Une tentative précédente a inséré la ligne puis est morte. Sans reprise,
    // cet événement ne serait jamais traité et la commande resterait impayée
    // en base alors que l'argent est pris.
    const { orderId } = await makeOrderWithArticle('ok3')
    const event = completedEvent({ id: 'evt_test_ok3', orderId })

    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        externalId: 'evt_test_ok3',
        payload: {},
        processedAt: null,
      },
    })

    const response = await POST(signedRequest(event))
    expect(response.status).toBe(200)

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })
    expect(order.status).toBe('PAID')
  })

  it('ne vend rien sur une session complétée mais non payée', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { orderId, articleId } = await makeOrderWithArticle('np1')

    const response = await POST(
      signedRequest(
        completedEvent({
          id: 'evt_test_np1',
          orderId,
          paymentStatus: 'unpaid',
        }),
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ skipped: 'not-paid' })

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })
    expect(order.status).toBe('PENDING_PAYMENT')

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('RESERVED')

    errors.mockRestore()
  })
})

describe('expiration', () => {
  it('rend le stock d’une commande jamais payée', async () => {
    const { orderId, articleId } = await makeOrderWithArticle('exp1')

    const response = await POST(
      signedRequest({
        id: 'evt_test_exp1',
        object: 'event',
        created: 1_755_770_400,
        type: 'checkout.session.expired',
        data: {
          object: {
            id: 'cs_test_exp1',
            object: 'checkout.session',
            metadata: { orderId },
          },
        },
      }),
    )

    expect(response.status).toBe(200)

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('AVAILABLE')
  })

  it('arrivée après le paiement, ne défait pas la vente', async () => {
    // Les événements ne sont pas ordonnés. Une expiration en retard ne doit
    // surtout pas remettre en vente une pièce déjà payée.
    const { orderId, articleId } = await makeOrderWithArticle('exp2')

    await POST(signedRequest(completedEvent({ id: 'evt_test_exp2a', orderId })))
    await POST(
      signedRequest({
        id: 'evt_test_exp2b',
        object: 'event',
        created: 1_755_770_400,
        type: 'checkout.session.expired',
        data: {
          object: { id: 'cs_x', object: 'checkout.session', metadata: { orderId } },
        },
      }),
    )

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })
    expect(order.status).toBe('PAID')

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('SOLD')
  })
})

describe('événements hors périmètre', () => {
  it('accuse réception sans erreur', async () => {
    // Un webhook qui renvoie 500 sur un événement dont il n'a que faire finit
    // désactivé par Stripe, et on perd alors ceux qui comptent.
    const response = await POST(
      signedRequest({
        id: 'evt_test_autre',
        object: 'event',
        created: 1_755_770_400,
        type: 'customer.created',
        data: { object: { id: 'cus_1', object: 'customer' } },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ignored: 'customer.created',
    })
  })
})
