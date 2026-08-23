import { describe, it, expect, afterEach, vi } from 'vitest'
import { authenticateSync, isSyncConfigured } from '@/lib/sync/auth'

/**
 * La porte d'entrée de l'import d'inventaire.
 *
 * Derrière elle, on écrit dans le catalogue. Ce qui compte ici : aucune forme
 * approchante de la clé ne passe, et une clé absente ferme la route au lieu de
 * l'ouvrir.
 */

const KEY = 'CLEF-DE-TEST-Ai9x3kQm2ZpL'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clé de synchronisation', () => {
  it('accepte la clé exacte', () => {
    vi.stubEnv('SYNC_API_KEY', KEY)
    expect(authenticateSync(`Bearer ${KEY}`)).not.toBeNull()
  })

  it('accepte un schéma écrit dans une autre casse', () => {
    // La RFC 7235 rend le schéma insensible à la casse. Un client qui écrit
    // « bearer » n'est pas un client hostile, et le refuser produirait un 401
    // incompréhensible.
    vi.stubEnv('SYNC_API_KEY', KEY)
    expect(authenticateSync(`bearer ${KEY}`)).not.toBeNull()
    expect(authenticateSync(`BEARER ${KEY}`)).not.toBeNull()
  })

  it('refuse une clé approchante', () => {
    vi.stubEnv('SYNC_API_KEY', KEY)

    expect(authenticateSync(`Bearer ${KEY}x`)).toBeNull()
    expect(authenticateSync(`Bearer ${KEY.slice(0, -1)}`)).toBeNull()
    expect(authenticateSync(`Bearer ${KEY.toLowerCase()}`)).toBeNull()
    expect(authenticateSync('Bearer ')).toBeNull()
  })

  it('refuse un autre schéma d’authentification', () => {
    vi.stubEnv('SYNC_API_KEY', KEY)
    expect(authenticateSync(`Basic ${KEY}`)).toBeNull()
    expect(authenticateSync(KEY)).toBeNull()
    expect(authenticateSync(null)).toBeNull()
  })

  it('refuse TOUT quand la clé n’est pas configurée', () => {
    // Le défaut à ne jamais avoir : une variable oubliée en production qui
    // ouvre l'écriture du catalogue au premier venu.
    vi.stubEnv('SYNC_API_KEY', '')

    expect(isSyncConfigured()).toBe(false)
    expect(authenticateSync('Bearer n’importe quoi')).toBeNull()
    expect(authenticateSync('Bearer ')).toBeNull()
  })

  it('ne renvoie jamais la clé, seulement un jeton opaque', () => {
    vi.stubEnv('SYNC_API_KEY', KEY)

    const caller = authenticateSync(`Bearer ${KEY}`)
    expect(caller?.counterKey).toBeTypeOf('string')
    expect(caller?.counterKey).not.toContain(KEY)
    // Le compteur de débit part chez un tiers : il ne doit rien porter de la
    // clé, même tronqué.
    expect(caller?.counterKey).toMatch(/^[0-9a-f]{32}$/)
  })

  it('donne le même jeton à deux appels de la même clé', () => {
    vi.stubEnv('SYNC_API_KEY', KEY)

    const first = authenticateSync(`Bearer ${KEY}`)
    const second = authenticateSync(`Bearer ${KEY}`)

    // Sinon le compteur de débit repartirait de zéro à chaque appel, et la
    // limitation ne limiterait rien.
    expect(first?.counterKey).toBe(second?.counterKey)
  })
})
