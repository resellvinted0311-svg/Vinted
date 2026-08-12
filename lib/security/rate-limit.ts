import 'server-only'

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
 */

export interface RateLimitInput {
  key: string
  limit: number
  windowSeconds: number
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
    // Redis indisponible : on laisse passer plutôt que de bloquer la
    // connexion de tout le monde, et on le signale.
    console.error(`[rate-limit] Upstash indisponible (${response.status}).`)
    return true
  }

  const body = (await response.json()) as { result?: number }
  const count = body.result ?? 0

  if (count === 1) {
    await fetch(
      `${url}/expire/${encodeURIComponent(namespaced)}/${windowSeconds}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    ).catch(() => undefined)
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
      console.error('[rate-limit] Appel Upstash en échec.', error)
      return true
    }
  }

  if (process.env.NODE_ENV === 'production' && !warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true
    console.error(
      '[rate-limit] UPSTASH_REDIS_REST_URL absent : la limitation de débit ' +
        'est en mémoire et ne protège pas une instance multiple.',
    )
  }

  return checkInMemory(input)
}

/** Réinitialise les compteurs en mémoire. Réservé aux tests. */
export function __resetRateLimitForTests(): void {
  memoryCounters.clear()
}
