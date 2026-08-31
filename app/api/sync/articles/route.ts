import { NextResponse, type NextRequest } from 'next/server'

import { checkRateLimit } from '@/lib/security/rate-limit'
import { authenticateSync } from '@/lib/sync/auth'
import {
  DemoSettingsInProductionError,
  MissingSettingError,
} from '@/lib/config/settings'
import { logger } from '@/lib/observability/logger'
import {
  loadSyncContext,
  syncArticle,
  type SyncResult,
} from '@/lib/sync/articles'
import {
  MAX_BATCH_SIZE,
  SYNC_RATE_LIMIT,
  SYNC_RATE_WINDOW_SECONDS,
} from '@/lib/validation/sync'

/**
 * Import d'inventaire depuis l'application de gestion.
 *
 * Contrat : `docs/synchronisation.md`. Cette route authentifie, limite le
 * débit, découpe le lot et choisit un code de statut. Toute la logique métier
 * est dans `lib/sync/articles.ts` — le brief l'exige, et c'est aussi ce qui
 * rend l'import testable sans monter un serveur HTTP.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `nodejs` et non `edge`
 * ---------------------------------------------------------------------------
 * Prisma, `node:crypto` et `sharp` en aval. Le temps d'exécution y est aussi
 * plus généreux, ce qui compte sur un lot de cent pièces.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Durée maximale de la fonction, en secondes.
 *
 * Elle manquait, et c'est un oubli qui s'est payé au premier import réel. Un lot
 * porte jusqu'à cent pièces, et chaque pièce ouvre sa PROPRE transaction — c'est
 * la garantie qu'une pièce refusée n'annule pas les autres. Cent transactions
 * derrière un pooler ne tiennent pas dans le budget par défaut.
 *
 * La fonction était donc tuée en cours de route, et la réponse arrivait SANS
 * corps : l'appelant recevait un `JSON.parse` en erreur, sans rien qui désigne
 * la cause. Un dépassement de temps doit se lire comme un dépassement de temps.
 *
 * Soixante secondes, comme la tâche planifiée, qui en fait beaucoup moins.
 */
export const maxDuration = 60


/**
 * Corps accepté, dans trois formes.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `dryRun` ne se met pas dans un article
 * ---------------------------------------------------------------------------
 * Le contrat annonçait « `?dryRun=1` ou `"dryRun": true` dans le corps ». Écrit
 * tel quel, cela obligeait à accepter une clé `dryRun` À L'INTÉRIEUR d'un objet
 * article — donc à mélanger une commande et une donnée, et à ouvrir une brèche
 * dans le refus des clés inconnues.
 *
 * `dryRun` est donc reconnu comme paramètre d'URL, ou comme clé de
 * l'enveloppe `{ articles: [...], dryRun: true }`. Un article seul ou un
 * tableau nu n'ont que le paramètre d'URL. Le document le précise.
 */
interface ParsedBody {
  articles: unknown[]
  dryRun: boolean
}

function readBody(raw: unknown): ParsedBody | null {
  if (Array.isArray(raw)) return { articles: raw, dryRun: false }

  if (raw && typeof raw === 'object') {
    const envelope = raw as { articles?: unknown; dryRun?: unknown }

    if (Array.isArray(envelope.articles)) {
      return {
        articles: envelope.articles,
        dryRun: envelope.dryRun === true,
      }
    }

    // Ni tableau, ni enveloppe : un article seul.
    return { articles: [raw], dryRun: false }
  }

  return null
}

function errorResponse(
  status: number,
  reason: string,
  detail: string,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(
    { ok: false, reason, detail, results: [] },
    { status, headers },
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ---- Authentification --------------------------------------------------
  const caller = authenticateSync(request.headers.get('authorization'))
  if (!caller) {
    // 401 et non 404 : de l'autre côté, quelqu'un doit pouvoir distinguer une
    // clé fausse d'une URL fausse. La route de cron répond 404 parce qu'elle
    // n'a aucun correspondant à renseigner ; ici, il y en a un.
    return errorResponse(
      401,
      'unauthorized',
      'clé de synchronisation absente ou invalide',
    )
  }

  // ---- Débit -------------------------------------------------------------
  //
  // `sensitive: true` : la route ÉCRIT dans le catalogue. Laisser passer en cas
  // de panne du compteur donnerait à qui détient la clé un moyen d'écrire sans
  // limite — et à qui l'a volée le temps d'un import complet avant qu'on s'en
  // aperçoive.
  const allowed = await checkRateLimit({
    key: `sync:articles:${caller.counterKey}`,
    limit: SYNC_RATE_LIMIT,
    windowSeconds: SYNC_RATE_WINDOW_SECONDS,
    sensitive: true,
  })

  if (!allowed) {
    return errorResponse(
      429,
      'rate-limited',
      `au-delà de ${SYNC_RATE_LIMIT} appels par minute`,
      { 'Retry-After': String(SYNC_RATE_WINDOW_SECONDS) },
    )
  }

  // ---- Corps -------------------------------------------------------------
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(400, 'invalid-json', 'corps illisible')
  }

  const body = readBody(raw)
  if (!body) {
    return errorResponse(
      400,
      'invalid-field',
      'le corps doit être un article, un tableau d’articles, ou { articles: [...] }',
    )
  }

  if (body.articles.length === 0) {
    return errorResponse(400, 'invalid-field', 'lot vide')
  }

  if (body.articles.length > MAX_BATCH_SIZE) {
    // Refus GLOBAL, et non article par article : un lot trop grand n'est pas
    // une collection de pièces invalides, c'est un lot mal découpé. Répondre
    // cent refus identiques ferait chercher l'erreur dans les données.
    return errorResponse(
      400,
      'payload-too-large',
      `${body.articles.length} articles : le maximum est ${MAX_BATCH_SIZE}`,
    )
  }

  const dryRun =
    body.dryRun || request.nextUrl.searchParams.get('dryRun') === '1'

  // ---- Traitement --------------------------------------------------------
  //
  // Séquentiel, volontairement. Chaque pièce ouvre une transaction, et la
  // connexion applicative est réglée à UNE seule en production
  // (`connection_limit=1`, recommandation de Prisma derrière un pooler) : lancer
  // cent transactions de front les ferait toutes attendre la même connexion,
  // jusqu'au délai du pool.
  try {
    const context = await loadSyncContext()
    const results: SyncResult[] = []

    for (const [index, article] of body.articles.entries()) {
      results.push(await syncArticle(article, index, context, { dryRun }))
    }

    return NextResponse.json(
      { ok: results.every((result) => result.action !== 'rejected'), results },
      { status: statusFor(results) },
    )
  } catch (error) {
    /**
     * Une boutique mal configurée n'est pas une panne, et ne doit pas se lire
     * comme telle.
     *
     * Sans ce filet, `getPricingConfig()` levait, Next rendait un 500 SANS
     * CORPS, et l'appelant n'avait rien à interpréter. C'est arrivé au premier
     * import réel : la personne a passé le message pour un dépassement de temps
     * et réduit ses lots, ce qui ne pouvait évidemment rien changer.
     *
     * Le refus est le même. Ce qu'on en dit change — et c'est exactement la
     * distinction qu'on a déjà dû faire sur la limitation de débit.
     */
    if (error instanceof DemoSettingsInProductionError) {
      return errorResponse(503, 'shop-not-configured', error.message)
    }

    if (error instanceof MissingSettingError) {
      return errorResponse(503, 'shop-not-configured', error.message)
    }

    // Tout le reste reste opaque VERS L'EXTÉRIEUR : un message d'exception peut
    // porter un nom de table, une requête, une valeur. Il part dans le journal,
    // pas dans la réponse.
    logger.failure('sync.articles_failed', error)
    return errorResponse(
      500,
      'internal-error',
      'la boutique a échoué en interne ; consultez ses journaux',
    )
  }
}

/**
 * Le code de statut d'un lot.
 *
 * `207` sur un lot mixte : l'objection de l'application était juste. Un `422`
 * global sur un lot dont quatre-vingt-dix-huit pièces sont passées annonce un
 * échec total, et pousse à tout renvoyer — donc à réécrire ce qui était déjà
 * correct.
 */
function statusFor(results: readonly SyncResult[]): number {
  const rejected = results.filter((result) => result.action === 'rejected')

  if (rejected.length === 0) return 200
  if (rejected.length === results.length) return 422
  return 207
}
