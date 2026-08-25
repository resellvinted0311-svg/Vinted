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

/** Renvoie `true` si l'appel est autorisé, `false` s'il doit être refusé. */
export async function checkRateLimit(input: RateLimitInput): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    try {
      return await checkUpstash(input, url, token)
    } catch (error) {
      logger.failure('rate_limit.backend_failed', error, {
        sensitive: input.sensitive ?? false,
      })
      // Chemin sensible : on refuse. Chemin de confort : on laisse passer.
      return !input.sensitive
    }
  }

  if (process.env.NODE_ENV === 'production' && !warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true
    logger.error('rate_limit.memory_fallback_in_production')
  }

  return checkInMemory(input)
}

/** Réinitialise les compteurs en mémoire. Réservé aux tests. */
export function __resetRateLimitForTests(): void {
  memoryCounters.clear()
}
