import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  pseudonymize,
  __resetPseudonymizationKeyForTests,
} from '@/lib/security/pseudonymize'

/**
 * Ce que ces tests protègent : plus aucune donnée personnelle ne doit sortir
 * du serveur sous une forme réversible.
 *
 * L'implémentation précédente hachait l'adresse IP en SHA-256 sans clé et
 * plaçait l'adresse e-mail EN CLAIR dans le chemin d'URL envoyé au
 * prestataire de compteurs. Les deux tests « ne ressemble pas à » ci-dessous
 * échouent sur cette version-là.
 */

const SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac'

let savedAuth: string | undefined
let savedNextAuth: string | undefined

beforeEach(() => {
  savedAuth = process.env.AUTH_SECRET
  savedNextAuth = process.env.NEXTAUTH_SECRET
  process.env.AUTH_SECRET = SECRET
  delete process.env.NEXTAUTH_SECRET
  __resetPseudonymizationKeyForTests()
})

afterEach(() => {
  if (savedAuth === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = savedAuth

  if (savedNextAuth === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = savedNextAuth

  __resetPseudonymizationKeyForTests()
})

describe('pseudonymize', () => {
  it('ne produit pas le haché sans clé de la valeur', () => {
    const ip = '203.0.113.42'
    const naive = createHash('sha256').update(ip).digest('hex').slice(0, 32)

    expect(pseudonymize({ purpose: 'rate-limit:ip', value: ip })).not.toBe(naive)
  })

  it('ne laisse transparaître ni l’adresse e-mail ni l’adresse IP', () => {
    const token = pseudonymize({
      purpose: 'rate-limit:signin-email',
      value: 'nina@exemple.fr',
    })

    expect(token).not.toContain('nina')
    expect(token).not.toContain('exemple')
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('est stable : le compteur doit pouvoir s’incrémenter', () => {
    const first = pseudonymize({ purpose: 'p', value: 'v' })
    const second = pseudonymize({ purpose: 'p', value: 'v' })

    expect(second).toBe(first)
  })

  it('cloisonne les usages : même valeur, jetons différents', () => {
    const forRateLimit = pseudonymize({ purpose: 'rate-limit:ip', value: 'v' })
    const forSomethingElse = pseudonymize({ purpose: 'autre-usage', value: 'v' })

    expect(forSomethingElse).not.toBe(forRateLimit)
  })

  it('ne confond pas deux découpages du même message concaténé', () => {
    // Sans séparateur, 'ab' + 'c' et 'a' + 'bc' donneraient le même jeton, et
    // deux valeurs distinctes partageraient un compteur.
    const left = pseudonymize({ purpose: 'ab', value: 'c' })
    const right = pseudonymize({ purpose: 'a', value: 'bc' })

    expect(right).not.toBe(left)
  })

  it('change de jeton d’un jour à l’autre quand la rotation est active', () => {
    const monday = pseudonymize({
      purpose: 'rate-limit:ip',
      value: '203.0.113.42',
      rotateDaily: true,
      now: new Date('2026-08-20T23:00:00Z'),
    })
    const tuesday = pseudonymize({
      purpose: 'rate-limit:ip',
      value: '203.0.113.42',
      rotateDaily: true,
      now: new Date('2026-08-21T01:00:00Z'),
    })

    expect(tuesday).not.toBe(monday)
  })

  it('reste stable au sein d’une même journée UTC', () => {
    const morning = pseudonymize({
      purpose: 'rate-limit:ip',
      value: '203.0.113.42',
      rotateDaily: true,
      now: new Date('2026-08-21T00:00:01Z'),
    })
    const evening = pseudonymize({
      purpose: 'rate-limit:ip',
      value: '203.0.113.42',
      rotateDaily: true,
      now: new Date('2026-08-21T23:59:59Z'),
    })

    expect(evening).toBe(morning)
  })

  it('dépend réellement du secret : un secret changé change le jeton', () => {
    const before = pseudonymize({ purpose: 'p', value: 'v' })

    process.env.AUTH_SECRET = `${SECRET}-autre`
    const after = pseudonymize({ purpose: 'p', value: 'v' })

    expect(after).not.toBe(before)
  })

  it('sans secret, tire une clé au hasard plutôt qu’une constante publiée', () => {
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET

    __resetPseudonymizationKeyForTests()
    const firstProcess = pseudonymize({ purpose: 'p', value: 'v' })

    // Deux appels du même processus restent cohérents : le compteur fonctionne.
    expect(pseudonymize({ purpose: 'p', value: 'v' })).toBe(firstProcess)

    // Mais un redémarrage repart d'une autre clé — donc rien n'est devinable
    // depuis le dépôt.
    __resetPseudonymizationKeyForTests()
    expect(pseudonymize({ purpose: 'p', value: 'v' })).not.toBe(firstProcess)
  })
})
