import { randomUUID } from 'node:crypto'

import { logger } from './logger'
import { describeError, redactFields, redactText, type LogFields } from './redact'

/**
 * Remontée des incidents vers Sentry — sans dépendance, et sans données
 * personnelles.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas `@sentry/nextjs`
 * ---------------------------------------------------------------------------
 * Ce n'est pas une question de poids. Le paquet officiel s'installe dans le
 * moteur d'exécution et capture TOUT SEUL le contexte de chaque requête :
 * l'URL, sa chaîne de requête, les en-têtes, parfois le corps. C'est ce qui en
 * fait un bon outil — et c'est exactement ce qu'on ne veut pas ici.
 *
 * Sur cette boutique, l'URL suffit à identifier quelqu'un : la page de retour
 * de paiement porte l'identifiant de session Stripe, les pages de suivi portent
 * le numéro de commande. `sendDefaultPii: false` retire l'adresse IP et les
 * cookies, pas la chaîne de requête. Il faudrait donc écrire un `beforeSend`
 * qui retire, chez un tiers, ce que la capture automatique a déjà rassemblé —
 * une liste d'exceptions qu'il faudrait rallonger à chaque page ajoutée, et
 * dont l'oubli ne se verrait jamais.
 *
 * On prend le problème par l'autre bout : RIEN ne part automatiquement. Cette
 * fonction envoie ce qu'on lui donne, caviardé par les mêmes règles que le
 * journal, et rien d'autre. Pas de contexte de requête, pas d'en-têtes, pas
 * d'utilisateur, pas de fil d'Ariane.
 *
 * Ce que l'on perd, et c'est assumé : les traces d'appel ne sont pas découpées
 * en cadres, donc ni reliées aux sources d'origine ni regroupées finement par
 * Sentry. La pile part en texte, caviardée. Sur une boutique d'une personne,
 * savoir QUE quelque chose casse et OÙ dans le fichier vaut cent fois mieux que
 * ne rien savoir, et c'était l'état précédent.
 *
 * ---------------------------------------------------------------------------
 * Il faut ATTENDRE l'envoi
 * ---------------------------------------------------------------------------
 * Sur une fonction serverless, le processus est gelé dès la réponse renvoyée.
 * Une promesse laissée en suspens ne part jamais, et personne ne le sait — le
 * code a l'air correct, l'incident n'arrive nulle part. C'est le raisonnement
 * qui a fait de la file de travaux différés une table plutôt qu'un
 * `setTimeout`, et il vaut ici mot pour mot.
 *
 * D'où une attente BORNÉE : deux secondes. Une requête déjà en échec peut se
 * permettre deux secondes de plus ; elle ne peut pas se permettre d'attendre un
 * tiers indéfiniment.
 */

/** Attente maximale accordée à Sentry. Voir l'en-tête. */
const TIMEOUT_MS = 2_000

interface ParsedDsn {
  endpoint: string
  publicKey: string
}

/**
 * Un DSN Sentry est une URL : `https://<clé publique>@<hôte>/<projet>`.
 *
 * Analysé une seule fois puis mémorisé. `undefined` = pas de DSN, la remontée
 * est inerte — ce qui est le cas tant que la variable n'est pas posée, et c'est
 * un état parfaitement valide : la boutique fonctionne sans.
 */
let cached: ParsedDsn | null | undefined
let warned = false

function parseDsn(raw: string): ParsedDsn | null {
  try {
    const url = new URL(raw)
    const projectId = url.pathname.replace(/^\//, '')
    if (!url.username || !projectId) return null

    // Le chemin peut porter un préfixe sur une instance auto-hébergée :
    // `https://clé@exemple.fr/sentry/42`. Le projet est le dernier segment.
    const segments = projectId.split('/')
    const project = segments.pop()
    if (!project) return null
    const prefix = segments.length > 0 ? `/${segments.join('/')}` : ''

    return {
      endpoint: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
      publicKey: url.username,
    }
  } catch {
    return null
  }
}

function dsn(): ParsedDsn | null {
  if (cached !== undefined) return cached

  const raw = process.env.SENTRY_DSN
  if (!raw) {
    cached = null
    return cached
  }

  cached = parseDsn(raw)

  if (!cached && !warned) {
    warned = true
    // Une seule fois : un DSN illisible ne doit pas produire une ligne par
    // incident, ce qui noierait précisément ce qu'on essaie de voir. Et la
    // valeur n'est PAS journalisée — elle porte une clé.
    logger.warn('sentry.dsn_invalid')
  }

  return cached
}

/** Remet l'analyse à zéro. Réservé aux tests, qui changent la variable. */
export function __resetSentryForTests(): void {
  cached = undefined
  warned = false
}

/** La remontée est-elle branchée ? Sert au registre et aux tests. */
export function sentryEnabled(): boolean {
  return dsn() !== null
}

/** Identifiant d'événement au format attendu : 32 hexadécimaux, sans tirets. */
function eventId(): string {
  return randomUUID().replace(/-/g, '')
}

/**
 * La pile d'appels, caviardée et bornée.
 *
 * Elle ne porte normalement que des chemins de fichiers et des numéros de
 * ligne. « Normalement » ne suffit pas : un message d'erreur figure en tête de
 * `stack`, et c'est lui qui peut porter une adresse. Le même filtre s'applique
 * donc ici qu'ailleurs.
 */
function safeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined
  return redactText(error.stack).slice(0, 4_000)
}

export interface CaptureContext {
  /** Le même nom stable que celui du journal, pour relier les deux. */
  event: string
  /** Champs additionnels, caviardés comme ceux du journal. */
  fields?: LogFields
}

/**
 * Envoie un incident à Sentry, et ne lève jamais.
 *
 * Renvoie `true` si l'envoi a abouti. Le résultat n'intéresse que les tests :
 * en exploitation, une remontée qui échoue ne doit surtout pas transformer une
 * panne en deux pannes.
 *
 * Journalise TOUJOURS, que Sentry soit branché ou non. Le journal est la trace
 * de référence ; Sentry n'est qu'une façon d'être prévenu.
 */
export async function captureException(
  error: unknown,
  context: CaptureContext,
): Promise<boolean> {
  logger.failure(context.event, error, context.fields)

  const target = dsn()
  if (!target) return false

  const { errorName, errorMessage } = describeError(error)
  const stack = safeStack(error)

  const id = eventId()
  const envelopeHeader = JSON.stringify({
    event_id: id,
    sent_at: new Date().toISOString(),
  })
  const itemHeader = JSON.stringify({ type: 'event' })
  const payload = JSON.stringify({
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    // `logger` porte le nom d'événement : c'est ce qui permet de retrouver dans
    // Sentry ce qu'on lit dans le journal, et l'inverse.
    logger: context.event,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    ...(process.env.VERCEL_GIT_COMMIT_SHA
      ? { release: process.env.VERCEL_GIT_COMMIT_SHA }
      : {}),
    exception: { values: [{ type: errorName, value: errorMessage }] },
    // Volontairement absents : `user`, `request`, `contexts`, `breadcrumbs`.
    // Ce sont les quatre endroits par lesquels une donnée personnelle entre
    // dans un outil de supervision sans que personne ne l'ait décidé.
    tags: { event: context.event },
    extra: {
      ...redactFields(context.fields ?? {}),
      ...(stack ? { stack } : {}),
    },
  })

  try {
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        // L'en-tête d'authentification plutôt que la chaîne de requête : une
        // clé dans une URL se retrouve dans les journaux d'accès du tiers.
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=nina-diego/1`,
      },
      body: `${envelopeHeader}\n${itemHeader}\n${payload}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      // On journalise le CODE, jamais le corps : une réponse d'erreur peut
      // renvoyer la requête envoyée, donc tout ce qu'on vient de composer.
      logger.warn('sentry.rejected', { status: response.status })
      return false
    }

    return true
  } catch (sendError) {
    // Volontairement `logger.failure` et non un nouvel appel à
    // `captureException` : une panne de Sentry ne doit pas déclencher une
    // tentative d'envoi vers Sentry, qui échouerait aussi, et ainsi de suite.
    logger.failure('sentry.unreachable', sendError)
    return false
  }
}
