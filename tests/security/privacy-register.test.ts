import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PROCESSING_REGISTER,
  activeProcessors,
  GUEST_DATA_RETENTION_DAYS,
  ACCOUNTING_RETENTION_DAYS,
} from '@/lib/config/privacy'
import { SHOP_SESSION_MAX_AGE_SECONDS } from '@/lib/shop/session-token'

/**
 * Le registre est la source d'une déclaration publique. Ces tests vérifient
 * qu'il ne peut ni mentir par omission, ni mentir par excès.
 */

const KEYS = [
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'UPSTASH_REDIS_REST_URL',
  'CLOUDINARY_CLOUD_NAME',
  'SENTRY_DSN',
] as const

const saved = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('sous-traitants déclarés', () => {
  it('n’annonce aucun prestataire qui ne traite rien', () => {
    const keys = activeProcessors().map((p) => p.key)

    // Hébergeur et base sont inconditionnels : dès qu'il y a un site, ils
    // traitent. Le reste n'apparaît que branché.
    expect(keys).toEqual(['vercel', 'supabase'])
  })

  it('déclare un prestataire dès qu’il est réellement branché', () => {
    process.env.RESEND_API_KEY = 'factice'
    expect(activeProcessors().map((p) => p.key)).toContain('resend')

    process.env.STRIPE_SECRET_KEY = 'factice'
    expect(activeProcessors().map((p) => p.key)).toContain('stripe')
  })

  it('dit pour chacun si les données sortent de l’Union', () => {
    process.env.RESEND_API_KEY = 'factice'
    process.env.STRIPE_SECRET_KEY = 'factice'
    process.env.UPSTASH_REDIS_REST_URL = 'https://factice'
    process.env.CLOUDINARY_CLOUD_NAME = 'factice'
    process.env.SENTRY_DSN = 'factice'

    for (const processor of activeProcessors()) {
      expect(processor.name.length, processor.key).toBeGreaterThan(0)
      expect(['eu', 'us-scc', 'eu-us-scc'], processor.key).toContain(
        processor.region,
      )
    }
  })
})

describe('durées de conservation', () => {
  it('ne fait pas survivre les données d’un visiteur à son cookie', () => {
    // Passé la durée de vie du cookie, plus personne ne peut retrouver ces
    // données — pas même la personne concernée. Les garder plus longtemps ne
    // servirait qu'à les garder.
    expect(GUEST_DATA_RETENTION_DAYS * 24 * 60 * 60).toBe(
      SHOP_SESSION_MAX_AGE_SECONDS,
    )
  })

  it('conserve les pièces comptables dix ans', () => {
    // Article L123-22 du code de commerce. C'est cette obligation qui écarte
    // l'effacement au titre de l'article 17.3.b du RGPD.
    expect(ACCOUNTING_RETENTION_DAYS).toBe(365 * 10)
  })

  it('justifie chaque durée par écrit', () => {
    for (const processing of PROCESSING_REGISTER) {
      expect(processing.retentionReason.length, processing.key).toBeGreaterThan(
        20,
      )
      expect(processing.tables.length, processing.key).toBeGreaterThan(0)
    }
  })

  it('n’a pas deux entrées pour la même clé', () => {
    const keys = PROCESSING_REGISTER.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('n’invoque « durée fixée ailleurs » que là où c’est vrai', () => {
    // ------------------------------------------------------------------
    // Pourquoi ce garde-fou existe
    // ------------------------------------------------------------------
    // `'external'` est un aveu : « nous n'appliquons pas cette durée, le
    // prestataire la règle ». C'est honnête pour des journaux, qui vivent
    // réellement chez l'hébergeur. Ce serait une échappatoire commode pour
    // n'importe quelle table de NOTRE base — il suffirait de l'écrire pour
    // n'avoir plus rien à purger, et la page publique n'y verrait que du feu.
    //
    // On borne donc : seul un traitement qui ne désigne AUCUNE table du schéma
    // peut s'en réclamer.
    const external = PROCESSING_REGISTER.filter(
      (processing) => processing.retentionDays === 'external',
    )

    expect(external.length, 'au moins une entrée, sinon ce test ne garde rien')
      .toBeGreaterThan(0)

    for (const processing of external) {
      for (const table of processing.tables) {
        expect(
          table.startsWith('('),
          `${processing.key} désigne « ${table} » : une table de notre base ne ` +
            'peut pas avoir une durée fixée ailleurs, elle doit être purgée ici',
        ).toBe(true)
      }
    }
  })

  it('n’annonce jamais une durée négative ou nulle', () => {
    // Zéro jour se lirait « effacé immédiatement », ce qu'aucune de ces
    // données n'est. Une valeur négative ne se lirait pas du tout.
    for (const processing of PROCESSING_REGISTER) {
      if (typeof processing.retentionDays !== 'number') continue
      expect(processing.retentionDays, processing.key).toBeGreaterThan(0)
    }
  })
})
