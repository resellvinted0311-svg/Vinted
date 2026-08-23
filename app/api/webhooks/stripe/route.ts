import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { redactStripeEvent } from '@/lib/payments/webhook-payload'
import { stripe, isStripeConfigured } from '@/lib/payments/stripe'
import { markOrderPaid, expireOrder } from '@/lib/shop/fulfilment'

/**
 * Webhook Stripe — la seule autorité sur « c'est payé ».
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas la page de retour
 * ---------------------------------------------------------------------------
 * Après un paiement, Stripe renvoie le navigateur sur une URL de la boutique.
 * C'est une redirection : n'importe qui peut l'ouvrir à la main, sans avoir
 * rien payé. Marquer une commande payée depuis cette page reviendrait à
 * distribuer des vêtements à qui sait recopier une URL. Le brief l'interdit
 * explicitement, et cette route est la raison pour laquelle il peut se le
 * permettre.
 *
 * ---------------------------------------------------------------------------
 * Signature sur le corps BRUT
 * ---------------------------------------------------------------------------
 * `request.text()` et jamais `request.json()`. La signature couvre les octets
 * exacts envoyés par Stripe ; les passer par un `JSON.parse` puis un
 * `JSON.stringify` change l'ordre des clés et les espaces, et la vérification
 * échoue — ou pire, on est tenté de la contourner.
 *
 * Sans `STRIPE_WEBHOOK_SECRET`, la route refuse tout. Traiter un événement non
 * signé, c'est laisser n'importe qui déclarer une commande payée par une
 * simple requête POST.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROVIDER = 'stripe'

/**
 * Événements traités.
 *
 * Tout le reste est enregistré puis ignoré — sans erreur. Un webhook qui
 * renvoie 500 sur un événement dont il n'a que faire finit désactivé par
 * Stripe pour cause d'échecs répétés, et on perd alors les événements qui
 * comptent.
 */
const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
])

function orderIdOf(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.orderId ?? session.client_reference_id ?? null
}

function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  const intent = session.payment_intent
  if (!intent) return null
  return typeof intent === 'string' ? intent : intent.id
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!isStripeConfigured() || !secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET absent : refus.')
    // 500 et non 200 : Stripe doit réessayer une fois la variable posée,
    // plutôt que de considérer l'événement comme reçu et le perdre.
    return NextResponse.json({ error: 'not-configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing-signature' }, { status: 400 })
  }

  const raw = await request.text()

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret)
  } catch (error) {
    // Signature invalide : ce n'est pas Stripe. 400 sans détail — inutile
    // d'expliquer à qui essaie ce qui n'a pas fonctionné.
    console.error(
      '[stripe-webhook] Signature invalide.',
      error instanceof Error ? error.message : 'erreur inconnue',
    )
    return NextResponse.json({ error: 'invalid-signature' }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // Idempotence
  // -------------------------------------------------------------------------
  // Stripe rejoue : sur timeout, sur 500, pendant un déploiement, et parfois
  // simplement en doublon. La contrainte unique (provider, externalId) est la
  // garantie qu'un événement rejoué n'est jamais traité deux fois.
  //
  // Subtilité : une tentative précédente a pu insérer la ligne PUIS mourir
  // avant d'avoir fini. Si l'on se contentait de sortir sur conflit, cet
  // événement-là ne serait jamais traité et la commande resterait impayée en
  // base alors que l'argent est pris. On regarde donc `processedAt` : posé,
  // on sort ; absent, on reprend.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: PROVIDER,
        externalId: event.id,
        // L'événement est CAVIARDÉ avant archivage. Tel quel, il porterait
        // `customer_details` — nom, e-mail, téléphone, adresse postale — dans
        // une seconde copie hors du registre, hors de l'export de l'article 15
        // et hors de l'effacement. Voir lib/payments/webhook-payload.ts.
        payload: redactStripeEvent(event) as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      throw error
    }

    const seen = await prisma.webhookEvent.findUnique({
      where: {
        provider_externalId: { provider: PROVIDER, externalId: event.id },
      },
      select: { processedAt: true },
    })

    if (seen?.processedAt) {
      return NextResponse.json({ received: true, duplicate: true })
    }
    // Sinon : reprise d'une tentative interrompue. On continue.
  }

  if (!HANDLED.has(event.type)) {
    await markProcessed(event.id, null)
    return NextResponse.json({ received: true, ignored: event.type })
  }

  try {
    const outcome = await handle(event)
    await markProcessed(event.id, null)
    return NextResponse.json({ received: true, ...outcome })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erreur inconnue'
    console.error(`[stripe-webhook] Échec sur ${event.type} :`, message)
    await markProcessed(event.id, message)

    // 500 : Stripe réessaiera. Le traitement est idempotent, donc une reprise
    // ne peut pas produire une seconde vente.
    return NextResponse.json({ error: 'processing-failed' }, { status: 500 })
  }
}

async function markProcessed(
  externalId: string,
  error: string | null,
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { provider_externalId: { provider: PROVIDER, externalId } },
    data: {
      // Une tentative en échec ne pose PAS `processedAt` : elle doit pouvoir
      // être reprise au prochain envoi de Stripe.
      processedAt: error ? null : new Date(),
      error,
    },
  })
}

async function handle(event: Stripe.Event): Promise<Record<string, unknown>> {
  const session = event.data.object as Stripe.Checkout.Session
  const orderId = orderIdOf(session)

  if (!orderId) {
    // Sans identifiant de commande, il n'y a rien à rapprocher. Ce n'est pas
    // une erreur à retenter : on le consigne et on passe.
    console.error(
      `[stripe-webhook] ${event.type} sans orderId (session ${session.id}).`,
    )
    return { skipped: 'no-order-reference' }
  }

  if (event.type === 'checkout.session.expired') {
    const released = await expireOrder(orderId)
    return { expired: released }
  }

  // checkout.session.completed
  //
  // La session peut être « complétée » sans être payée — c'est le cas des
  // moyens de paiement différés. Nous n'acceptons que la carte, donc cela ne
  // devrait pas arriver ; le vérifier coûte une ligne et empêche qu'activer un
  // autre moyen demain ne transforme une promesse de paiement en vente.
  if (session.payment_status !== 'paid') {
    console.error(
      `[stripe-webhook] Session ${session.id} complétée sans paiement ` +
        `(payment_status=${session.payment_status}). Commande laissée en attente.`,
    )
    return { skipped: 'not-paid' }
  }

  const result = await markOrderPaid({
    orderId,
    paymentIntentId: paymentIntentIdOf(session),
    // L'horodatage vient de l'ÉVÉNEMENT, pas de l'horloge de cette fonction :
    // c'est la date qui figurera sur la facture, et elle doit correspondre au
    // relevé bancaire. Une reprise trois heures plus tard ne doit pas dater la
    // vente de trois heures plus tard.
    paidAt: new Date(event.created * 1000),
  })

  if (result.unfulfillableArticleIds.length > 0) {
    // L'argent est pris et une pièce est partie ailleurs. Consigné bruyamment :
    // un remboursement est dû, et c'est une décision humaine.
    console.error(
      `[stripe-webhook] Commande ${orderId} : ` +
        `${result.unfulfillableArticleIds.length} ligne(s) non honorables, ` +
        'remboursement à traiter.',
    )
  }

  return {
    applied: result.applied,
    sold: result.soldArticleIds.length,
    unfulfillable: result.unfulfillableArticleIds.length,
  }
}
