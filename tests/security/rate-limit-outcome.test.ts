import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  checkRateLimit,
  rateLimitOutcome,
  __resetRateLimitForTests,
} from '@/lib/security/rate-limit'

/**
 * Panne du compteur et dépassement du plafond ne se disent pas pareil.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ces tests verrouillent
 * ---------------------------------------------------------------------------
 * Le refus est le même dans les deux cas, et il doit le rester : un chemin
 * sensible se ferme quand le compteur ne répond pas. Mais l'appelant ne
 * recevait qu'un `false`, et affichait « trop de tentatives ».
 *
 * C'est arrivé en production, à la mise en service : deux variables Upstash mal
 * recopiées, et la PREMIÈRE inscription du site a été refusée avec un message
 * qui accusait l'utilisateur d'avoir trop insisté. La personne a cherché ce
 * qu'elle avait fait de mal, et attendu une échéance qui n'existait pas.
 *
 * Ces tests tiennent les deux moitiés de la règle : le refus reste un refus, et
 * sa CAUSE reste distinguable.
 */

const SENSIBLE = { key: 'essai', limit: 5, windowSeconds: 60, sensitive: true }
const CONFORT = { ...SENSIBLE, sensitive: false }

function brancherUpstash(): void {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://exemple.invalid')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'jeton-d-essai')
}

/** Une réponse d'INCR, telle que l'API REST d'Upstash la rend. */
function reponseIncr(compte: number): Response {
  return new Response(JSON.stringify({ result: compte }), { status: 200 })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  __resetRateLimitForTests()
})

describe('quand le compteur ne répond pas', () => {
  it('REFUSE un chemin sensible, en disant que c’est une panne', async () => {
    brancherUpstash()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau coupé')))

    // Le refus est maintenu : laisser passer pendant une panne offrirait la
    // force brute à qui sait provoquer la panne.
    expect(await rateLimitOutcome(SENSIBLE)).toBe('unavailable')
    expect(await checkRateLimit(SENSIBLE)).toBe(false)
  })

  it('LAISSE PASSER un chemin de confort', async () => {
    brancherUpstash()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau coupé')))

    // Bloquer la recherche parce que Redis tousse punirait des clientes pour
    // rien.
    expect(await rateLimitOutcome(CONFORT)).toBe('allowed')
  })

  it('traite un quota épuisé (429) comme une panne, pas comme un feu vert', async () => {
    // C'est précisément l'état qu'un attaquant peut provoquer en martelant un
    // chemin bon marché : s'ouvrir ici lui offrirait de désactiver toute la
    // protection.
    brancherUpstash()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    )

    expect(await rateLimitOutcome(SENSIBLE)).toBe('unavailable')
  })
})

describe('quand le compteur répond', () => {
  it('autorise sous le plafond', async () => {
    brancherUpstash()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseIncr(1)))

    expect(await rateLimitOutcome(SENSIBLE)).toBe('allowed')
  })

  it('dit « limited » au-delà — et surtout PAS « unavailable »', async () => {
    brancherUpstash()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseIncr(6)))

    // La distinction se joue ici : « limited » veut dire qu'attendre l'échéance
    // suffit. « unavailable » veut dire qu'attendre n'y fera rien. Les confondre
    // envoie la personne au mauvais endroit.
    expect(await rateLimitOutcome(SENSIBLE)).toBe('limited')
  })

  it('autorise pile AU plafond, refuse au suivant', async () => {
    brancherUpstash()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseIncr(5)))
    expect(await rateLimitOutcome(SENSIBLE)).toBe('allowed')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseIncr(6)))
    expect(await rateLimitOutcome(SENSIBLE)).toBe('limited')
  })
})

describe('sans Upstash configuré', () => {
  it('compte en mémoire et dit « limited », jamais « unavailable »', async () => {
    // Le repli en mémoire est inadapté à la production et le signale ailleurs.
    // Ce qui compte ici : il ne doit pas se faire passer pour une panne, sinon
    // le développement afficherait un message d'incident à chaque plafond.
    for (let essai = 0; essai < 5; essai += 1) {
      expect(await rateLimitOutcome(SENSIBLE)).toBe('allowed')
    }
    expect(await rateLimitOutcome(SENSIBLE)).toBe('limited')
  })
})
