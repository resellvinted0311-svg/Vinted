import 'server-only'

import { logger } from '@/lib/observability/logger'

/**
 * Limitation de débit — fenêtre fixe.
 *
 * Deux implémentations :
 *  - Upstash Redis quand les variables sont présentes (production) ;
 *  - compteur en mémoire sinon (développement et tests).
 *
 * Le compteur en mémoire ne survit pas au redémarrage et n'est pas partagé
 * entre instances : il est délibérément inadapté à la production, et le
 * signale au démarrage plutôt que de donner une fausse impression de
 * protection.
 *
 * ---------------------------------------------------------------------------
 * Que faire quand le compteur ne répond plus
 * ---------------------------------------------------------------------------
 * La version précédente laissait passer dans TOUS les cas d'échec — magasin
 * indisponible, quota épuisé, panne réseau. Conséquence : il suffisait de
 * marteler l'autocomplétion jusqu'à épuiser le quota du plan pour désactiver,
 * du même coup, la protection de la page de connexion.
 *
 * Le bon comportement dépend de ce qu'on protège, et ne peut donc pas être
 * unique :
 *
 *  - un chemin de CONFORT (recherche, autocomplétion) s'ouvre en cas de
 *    panne. Bloquer la recherche parce que Redis tousse punirait des clientes
 *    pour rien ;
 *  - un chemin SENSIBLE (connexion, inscription, lien magique) se ferme.
 *    Refuser une connexion pendant une panne est ennuyeux ; laisser une force
 *    brute s'exécuter sans frein pendant cette même panne est une brèche.
 *
 * L'appelant doit donc le déclarer. `sensitive` n'a pas de valeur par défaut
 * permissive : c'est un booléen obligatoire, pour qu'on ne puisse pas oublier
 * d'y penser.
 */

export interface RateLimitInput {
  key: string
  limit: number
  windowSeconds: number
  /**
   * `true` : en cas de panne du compteur, on REFUSE (connexion, inscription,
   * lien magique, paiement). `false` : on laisse passer (recherche, favoris).
   *
   * Sans valeur par défaut, volontairement.
   */
  sensitive: boolean
}

const memoryCounters = new Map<string, { count: number; resetAt: number }>()
let warnedAboutMemoryFallback = false

function checkInMemory({ key, limit, windowSeconds }: RateLimitInput): boolean {
  const now = Date.now()
  const entry = memoryCounters.get(key)

  if (!entry || entry.resetAt <= now) {
    memoryCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })

    // Purge opportuniste : la table reste bornée sans minuterie dédiée.
    if (memoryCounters.size > 10_000) {
      for (const [k, v] of memoryCounters) {
        if (v.resetAt <= now) memoryCounters.delete(k)
      }
    }
    return true
  }

  if (entry.count >= limit) return false

  entry.count += 1
  return true
}

async function checkUpstash(
  { key, limit, windowSeconds }: RateLimitInput,
  url: string,
  token: string,
): Promise<boolean> {
  const namespaced = `rl:${key}`

  // INCR puis EXPIRE sur la première occurrence : deux allers-retours, mais
  // aucune dépendance à un script Lua côté serveur Redis.
  const response = await fetch(`${url}/incr/${encodeURIComponent(namespaced)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    // Le quota du plan épuisé renvoie 429 : c'est précisément l'état qu'un
    // attaquant peut provoquer en martelant un chemin bon marché. Ouvrir ici
    // reviendrait à lui offrir la désactivation de toute la protection.
    logger.error('rate_limit.backend_unavailable', { status: response.status })
    throw new Error(`upstash-unavailable-${response.status}`)
  }

  const body = (await response.json()) as { result?: number }
  const count = body.result ?? 0

  if (count === 1) {
    // L'échéance n'est PAS posée « au cas où ». Sans elle, le compteur ne
    // redescend jamais : après quelques inscriptions, tout un réseau
    // d'entreprise ou tout un opérateur mobile — qui partagent une IP — se
    // verrait refuser l'accès définitivement, sans message compréhensible.
    // On efface donc la clé plutôt que de laisser un compteur immortel.
    const expire = await fetch(
      `${url}/expire/${encodeURIComponent(namespaced)}/${windowSeconds}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    ).catch(() => null)

    if (!expire?.ok) {
      logger.warn('rate_limit.expiry_not_set', { counter: namespaced })
      await fetch(`${url}/del/${encodeURIComponent(namespaced)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }).catch(() => undefined)
    }
  }

  return count <= limit
}

/**
 * Efface un compteur, sans attendre son échéance.
 *
 * ---------------------------------------------------------------------------
 * À quoi cela sert, et pourquoi ce n'est pas un contournement
 * ---------------------------------------------------------------------------
 * Un compteur d'ÉCHECS doit repartir de zéro quand le geste réussit. Sans cela,
 * il ne compte plus les échecs consécutifs mais les tentatives tout court, et
 * finit par refuser quelqu'un qui n'a rien fait de mal — la connexion d'une
 * personne qui se connecte souvent, par exemple.
 *
 * L'effacement n'est donc jamais offert à l'appelant : il n'a lieu qu'après une
 * preuve. Sur la connexion, cette preuve est le mot de passe correct — ce que
 * l'attaquant cherche précisément et n'a pas.
 *
 * ---------------------------------------------------------------------------
 * Un échec d'effacement ne casse rien
 * ---------------------------------------------------------------------------
 * Si le prestataire est injoignable, le compteur reste en place et s'éteindra
 * de lui-même à son échéance. Le pire des cas est donc une borne un peu plus
 * stricte pendant une heure, jamais une porte ouverte : on ne lève pas, on
 * journalise.
 */
export async function clearRateLimit(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  // Le compteur en mémoire porte la clé nue ; celui d'Upstash est préfixé.
  // Se tromper de forme ici effacerait une clé qui n'existe pas, sans erreur —
  // le pire des échecs, celui qui a l'air de marcher.
  if (!url || !token) {
    memoryCounters.delete(key)
    return
  }

  try {
    await fetch(`${url}/del/${encodeURIComponent(`rl:${key}`)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch (error) {
    logger.failure('rate_limit.clear_failed', error)
  }
}

/**
 * Pourquoi un refus n'est pas l'autre.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que cette distinction ferme
 * ---------------------------------------------------------------------------
 * Un chemin sensible se ferme quand le compteur ne répond pas — c'est la bonne
 * décision, et elle ne change pas. Mais l'appelant ne recevait qu'un `false`,
 * indiscernable d'un vrai dépassement : la personne lisait « trop de
 * tentatives » à sa PREMIÈRE, et cherchait ce qu'elle avait fait de mal.
 *
 * C'est arrivé en vrai, à la mise en service : deux variables Upstash mal
 * recopiées, et la première inscription du site a été refusée avec un message
 * qui accusait l'utilisateur. Vingt minutes de recherche au mauvais endroit,
 * parce que le message était faux.
 *
 * Le refus est le même. Ce qui change est ce qu'on peut en DIRE.
 */
export type RateLimitOutcome =
  /** Sous le plafond. */
  | 'allowed'
  /** Plafond atteint : attendre l'échéance de la fenêtre. */
  | 'limited'
  /** Le compteur ne répond pas, et le chemin est sensible : attendre n'y fera rien. */
  | 'unavailable'

export async function rateLimitOutcome(
  input: RateLimitInput,
): Promise<RateLimitOutcome> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    try {
      return (await checkUpstash(input, url, token)) ? 'allowed' : 'limited'
    } catch (error) {
      logger.failure('rate_limit.backend_failed', error, {
        sensitive: input.sensitive ?? false,
      })
      // Chemin sensible : on refuse. Chemin de confort : on laisse passer.
      return input.sensitive ? 'unavailable' : 'allowed'
    }
  }

  if (process.env.NODE_ENV === 'production' && !warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true
    logger.error('rate_limit.memory_fallback_in_production')
  }

  return checkInMemory(input) ? 'allowed' : 'limited'
}

/**
 * Autorisé, oui ou non.
 *
 * Reste la forme normale pour tout ce qui répond à un PROGRAMME — routes JSON,
 * synchronisation, actions de la régie. Un client HTTP reçoit un 429 et
 * réessaie ; la nuance ne lui apporte rien.
 *
 * Les écrans que lit une personne appellent `rateLimitOutcome` et distinguent.
 */
export async function checkRateLimit(input: RateLimitInput): Promise<boolean> {
  return (await rateLimitOutcome(input)) === 'allowed'
}

/** Réinitialise les compteurs en mémoire. Réservé aux tests. */
export function __resetRateLimitForTests(): void {
  memoryCounters.clear()
}
