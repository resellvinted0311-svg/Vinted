import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { releaseExpiredStockLocks } from '@/lib/shop/stock-lock'
import { purgeExpiredPersonalData } from '@/lib/privacy/retention'
import { expireStaleOrders } from '@/lib/shop/fulfilment'
import { runJobs } from '@/lib/jobs/worker'

/**
 * Travaux périodiques.
 *
 * Appelée par Vercel Cron selon la planification de `vercel.json`. Aucune autre
 * route ne déclenche ces travaux : ils modifient du stock, et doivent avoir un
 * seul point d'entrée, contrôlé.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un secret, et pourquoi une comparaison à temps constant
 * ---------------------------------------------------------------------------
 * Sans secret, n'importe qui pourrait déclencher la libération des
 * réservations en boucle et faire tomber des paiements en cours. Vercel envoie
 * `Authorization: Bearer <CRON_SECRET>` ; on le vérifie sans jamais court-
 * circuiter la comparaison au premier octet différent, ce qui laisserait
 * deviner le secret caractère par caractère.
 *
 * Sans `CRON_SECRET` configuré, la route REFUSE tout : une porte ouverte par
 * défaut sur du stock ne se rattrape pas.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Durée maximale de la fonction, en secondes.
 *
 * La valeur par défaut de Vercel se compte en dizaines de secondes, et elle
 * suffisait tant que la file ne portait que des e-mails. Le réhébergement des
 * visuels d'une pièce importée — jusqu'à dix images à télécharger, décoder,
 * redresser et téléverser — ne tient pas dedans.
 *
 * Une fonction tuée en cours de route est le pire des cas : le verrou du
 * travail reste posé un quart d'heure et rien n'a été écrit. `runJobs` s'arrête
 * donc de lui-même bien avant cette borne ; celle-ci est le filet, pas le
 * budget.
 */
export const maxDuration = 60

/**
 * Délai avant d'annuler une commande jamais payée, en minutes.
 *
 * Confortablement au-delà de la durée d'une session de paiement (trente
 * minutes, minimum imposé par Stripe) : on ne veut pas courir après un
 * événement d'expiration qui arriverait avec quelques minutes de retard.
 */
const STALE_ORDER_GRACE_MINUTES = 120

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  // `timingSafeEqual` exige des longueurs égales : on les compare d'abord,
  // ce qui ne divulgue que la longueur du secret — sans intérêt pour qui
  // cherche à le deviner.
  const given = Buffer.from(header)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false

  return timingSafeEqual(given, wanted)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    // 404 plutôt que 401 : inutile de confirmer l'existence de la route à qui
    // n'a pas le secret.
    return new NextResponse(null, { status: 404 })
  }

  const startedAt = Date.now()

  // Les travaux sont indépendants : l'échec de l'un ne doit pas empêcher les
  // autres. `allSettled` le garantit — une purge qui tombe ne doit pas laisser
  // du stock réservé indéfiniment, et réciproquement.
  const [locks, purge, orders, jobs] = await Promise.allSettled([
    releaseExpiredStockLocks(),
    purgeExpiredPersonalData(),
    // Stripe envoie bien `checkout.session.expired`, mais un webhook peut se
    // perdre. Sans ce balayage, ces commandes resteraient en attente de
    // paiement pour toujours alors que leur stock a été rendu.
    //
    // La marge est large : annuler trop tôt ne perd pas la vente — un
    // paiement tardif rouvre la commande — mais produit un aller-retour
    // inutile dans l'historique.
    expireStaleOrders(STALE_ORDER_GRACE_MINUTES),
    // Confirmations de commande et avis à la boutique. Inscrits dans la
    // transaction de la vente, exécutés ici : un e-mail dû est un e-mail qui
    // survit à une panne du prestataire.
    runJobs(),
  ])

  if (locks.status === 'rejected') {
    console.error('[cron] Libération des réservations en échec.', locks.reason)
  }
  if (purge.status === 'rejected') {
    console.error('[cron] Purge des données personnelles en échec.', purge.reason)
  }
  if (orders.status === 'rejected') {
    console.error('[cron] Balayage des commandes en attente en échec.', orders.reason)
  }
  if (jobs.status === 'rejected') {
    console.error('[cron] Exécution des travaux différés en échec.', jobs.reason)
  }

  return NextResponse.json({
    ok: [locks, purge, orders, jobs].every(
      (task) => task.status === 'fulfilled',
    ),
    releasedLocks: locks.status === 'fulfilled' ? locks.value : null,
    purged: purge.status === 'fulfilled' ? purge.value : null,
    expiredOrders: orders.status === 'fulfilled' ? orders.value : null,
    jobs: jobs.status === 'fulfilled' ? jobs.value : null,
    durationMs: Date.now() - startedAt,
  })
}
