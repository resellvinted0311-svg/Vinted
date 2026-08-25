import { describeError, redactFields, type LogFields } from './redact'

/**
 * Le journal du serveur : une ligne JSON par événement.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module remplace, et pourquoi ce n'était pas suffisant
 * ---------------------------------------------------------------------------
 * Vingt-sept appels à `console.error` portant une phrase française préfixée
 * d'un mot entre crochets :
 *
 *     console.error('[rate-limit] Upstash indisponible (503).')
 *
 * C'est lisible par un humain qui regarde au bon moment. Ce n'est rien d'autre.
 * On ne peut pas COMPTER les indisponibilités d'Upstash, on ne peut pas ALERTER
 * au-delà d'un seuil, on ne peut pas retrouver toutes les traces d'une même
 * commande, et on ne peut pas distinguer un incident d'une erreur attendue —
 * parce qu'il n'existe aucun champ sur lequel filtrer. Le cahier des charges
 * demande des journaux structurés ; une phrase n'en est pas un.
 *
 * ---------------------------------------------------------------------------
 * Une ligne JSON, et pas un objet multiligne
 * ---------------------------------------------------------------------------
 * Les collecteurs — celui de Vercel comme les autres — découpent la sortie par
 * LIGNE. Un JSON indenté sur douze lignes devient douze entrées, dont onze
 * illisibles. `JSON.stringify` sans indentation est donc le format, pas une
 * économie de place.
 *
 * ---------------------------------------------------------------------------
 * Le nom d'événement est stable, le texte ne l'est pas
 * ---------------------------------------------------------------------------
 * `event: 'rate_limit.backend_unavailable'` se compte et s'alerte. La phrase
 * qui l'accompagne peut être réécrite, traduite, corrigée sans rien casser.
 * L'inverse — filtrer sur un morceau de phrase — casse au premier
 * remaniement, silencieusement, et l'alerte cesse de se déclencher sans que
 * personne ne le remarque.
 *
 * ---------------------------------------------------------------------------
 * Aucune donnée personnelle, garanti par construction
 * ---------------------------------------------------------------------------
 * Les champs ne traversent pas : ils passent par `redactFields`, qui filtre par
 * nom ET par forme. Un `Error` n'est jamais journalisé tel quel — voir le
 * défaut Prisma décrit dans `redact.ts`.
 *
 * ---------------------------------------------------------------------------
 * Synchrone, délibérément
 * ---------------------------------------------------------------------------
 * Écrire sur la sortie standard ne demande aucune attente, et un journal qu'il
 * faudrait attendre serait oublié quelque part. L'envoi vers Sentry, lui, est
 * un appel réseau : il vit dans `sentry.ts`, il est explicite, et il s'attend —
 * sur une fonction serverless, une promesse non attendue ne part jamais, le
 * processus étant gelé dès la réponse renvoyée. C'est le même raisonnement que
 * celui qui a fait de la file de travaux différés une table, et non un
 * `setTimeout`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  /** Nom stable, en minuscules pointées. Se compte, s'alerte, se filtre. */
  event: string
  fields: LogFields
}

/**
 * Où la ligne part réellement.
 *
 * `console.error` pour `warn` et `error` : la sortie d'ERREUR standard, que les
 * plateformes distinguent de la sortie normale. Sans cela, une alerte réglée
 * sur stderr ne verrait jamais nos avertissements.
 */
function writeLine(level: LogLevel, line: string): void {
  if (level === 'error' || level === 'warn') {
    console.error(line)
    return
  }
  console.log(line)
}

/**
 * Niveau plancher, réglable sans redéploiement.
 *
 * `debug` est muet par défaut, y compris en production : une ligne par lecture
 * de configuration multiplierait le volume par cent pour un intérêt qui ne dure
 * que le temps d'une enquête.
 */
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function minimumLevel(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase()
  if (configured && configured in ORDER) return ORDER[configured as LogLevel]
  return ORDER.info
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (ORDER[level] < minimumLevel()) return

  const entry = {
    // `ts` en premier : sur un journal lu à l'œil nu, la date en tête est ce
    // qui rend la lecture possible sans outil.
    ts: new Date().toISOString(),
    level,
    event,
    ...redactFields(fields),
  }

  try {
    writeLine(level, JSON.stringify(entry))
  } catch {
    // Une valeur non sérialisable — une référence circulaire glissée dans un
    // champ — ne doit pas faire échouer la requête qu'on essayait de décrire.
    // Un journal qui casse le service qu'il observe est pire que pas de
    // journal.
    writeLine(level, JSON.stringify({ ts: entry.ts, level, event, fields: 'illisible' }))
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),

  /**
   * Journalise une erreur sans jamais journaliser l'objet.
   *
   * Les champs de l'appelant l'emportent sur ceux dérivés de l'erreur : un
   * appelant qui précise `errorMessage` sait mieux que nous ce qu'il veut dire.
   */
  failure: (event: string, error: unknown, fields?: LogFields) =>
    emit('error', event, { ...describeError(error), ...fields }),
}
