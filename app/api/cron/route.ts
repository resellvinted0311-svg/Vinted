import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { releaseExpiredStockLocks } from '@/lib/shop/stock-lock'
import { purgeExpiredPersonalData } from '@/lib/privacy/retention'
import { expireStaleOrders } from '@/lib/shop/fulfilment'
import { expireStaleOffers } from '@/lib/shop/offers'
import { applyDuePriceDrops } from '@/lib/shop/price-drop'
import { runJobs } from '@/lib/jobs/worker'
import { captureException } from '@/lib/observability/sentry'
import { logger } from '@/lib/observability/logger'
import {
  pullInventaire,
  PullNotConfiguredError,
  type PullReport,
} from '@/lib/sync/pull'

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
  const [locks, purge, orders, offers, drops, jobs] = await Promise.allSettled([
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
    // Une offre sans réponse s'éteint d'elle-même. Sans ce balayage, elle
    // resterait « en attente » indéfiniment : l'acheteuse attendrait une
    // réponse qui ne vient pas, et le plafond de tentatives la tiendrait
    // enfermée sur cette pièce puisqu'une offre en attente en interdit une
    // seconde.
    expireStaleOffers(),
    // Le barème de baisse (Setting.autoDropSchedule) appliqué aux pièces qui
    // ont atteint un palier d'ancienneté. Chaque baisse inscrit sa remontée
    // vers l'application de gestion dans la même transaction — sans elle, le
    // prochain import réécrirait le prix d'avant.
    applyDuePriceDrops(),
    // Confirmations de commande et avis à la boutique. Inscrits dans la
    // transaction de la vente, exécutés ici : un e-mail dû est un e-mail qui
    // survit à une panne du prestataire.
    runJobs(),
  ])

  /**
   * La synchronisation de l'inventaire, APRÈS les autres et jamais avec elles.
   *
   * -------------------------------------------------------------------------
   * Pourquoi séquentiel
   * -------------------------------------------------------------------------
   * Les six travaux ci-dessus sont brefs et se partagent bien l'unique
   * connexion applicative. Celui-ci écrit des centaines de pièces : lancé de
   * front, il ferait attendre les autres derrière lui, et une libération de
   * verrou de stock retardée d'une minute est une vente perdue.
   *
   * Il reçoit donc ce qui RESTE du budget de la fonction, une fois le reste
   * fait. C'est aussi le bon ordre de priorité : le ménage d'abord, l'import
   * ensuite — un import repoussé d'un passage ne coûte rien, puisqu'il reprend
   * là où il s'est arrêté.
   */
  const pull = await (async (): Promise<PullReport | null> => {
    const reste = maxDuration * 1000 - (Date.now() - startedAt)

    // Sous ce seuil, entamer l'import ferait tuer la fonction avant qu'elle
    // n'ait rendu son compte rendu — et on perdrait aussi celui des six autres.
    if (reste < 10_000) return null

    try {
      return await pullInventaire({ budgetMs: reste * 0.8 })
    } catch (error) {
      /**
       * Une boutique sans clé de lecture n'est pas en panne.
       *
       * Tant que les variables ne sont pas posées, ce travail n'a simplement
       * pas lieu — et le remonter comme une exception ferait sonner une alerte
       * toutes les nuits pour une configuration qu'on a peut-être choisie.
       */
      if (error instanceof PullNotConfiguredError) {
        logger.info('cron.pull_not_configured', {
          missing: error.manquantes.length,
        })
        return null
      }
      captureException(error, { event: 'cron.pull_failed' })
      return null
    }
  })()

  // ---------------------------------------------------------------------------
  // Chaque échec est REMONTÉ, pas seulement journalisé
  // ---------------------------------------------------------------------------
  // C'est ici que la supervision compte le plus. Ces six travaux tournent sans
  // personne devant : une purge qui échoue tous les jours pendant un mois ne se
  // voit nulle part — la boutique fonctionne, les pages s'affichent, et les
  // données personnelles qu'on annonce effacer restent en base. C'est une
  // déclaration publique qui devient fausse en silence.
  //
  // `await` et non un envoi laissé en suspens : sur une fonction serverless, le
  // processus est gelé dès la réponse renvoyée, et une promesse non attendue ne
  // part jamais. C'est le raisonnement qui a fait de la file de travaux une
  // table plutôt qu'un `setTimeout`.
  await Promise.all(
    (
      [
        ['cron.release_locks_failed', locks],
        ['cron.purge_failed', purge],
        ['cron.expire_orders_failed', orders],
        ['cron.expire_offers_failed', offers],
        ['cron.price_drops_failed', drops],
        ['cron.run_jobs_failed', jobs],
      ] as const
    )
      .filter(([, task]) => task.status === 'rejected')
      .map(([event, task]) =>
        captureException((task as PromiseRejectedResult).reason, { event }),
      ),
  )

  return NextResponse.json({
    ok: [locks, purge, orders, offers, drops, jobs].every(
      (task) => task.status === 'fulfilled',
    ),
    releasedLocks: locks.status === 'fulfilled' ? locks.value : null,
    purged: purge.status === 'fulfilled' ? purge.value : null,
    expiredOrders: orders.status === 'fulfilled' ? orders.value : null,
    expiredOffers: offers.status === 'fulfilled' ? offers.value : null,
    priceDrops: drops.status === 'fulfilled' ? drops.value : null,
    jobs: jobs.status === 'fulfilled' ? jobs.value : null,
    inventaire: pull,
    durationMs: Date.now() - startedAt,
  })
}
