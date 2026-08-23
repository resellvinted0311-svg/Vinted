import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locales } from '@/lib/i18n/routing'
import { PROCESSING_REGISTER } from '@/lib/config/privacy'
import {
  ARTICLE_COLORS,
  ARTICLE_CONDITIONS,
  ARTICLE_FITS,
  ARTICLE_MATERIALS,
  MEASUREMENT_KEYS,
} from '@/lib/domain/vocabulary'

/**
 * Les 8 fichiers de traduction doivent porter exactement les mêmes clés.
 *
 * Une clé oubliée dans une langue produit un libellé technique en production
 * (« nav.cart ») plutôt qu'une erreur : sans ce test, ça passe inaperçu.
 */

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

function loadMessages(locale: string): unknown {
  const path = join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

const reference = flattenKeys(loadMessages('fr')).sort()

describe('fichiers de traduction', () => {
  it('couvre les 8 langues annoncées', () => {
    expect(locales).toHaveLength(8)
  })

  for (const locale of locales) {
    it(`${locale} porte exactement les mêmes clés que fr`, () => {
      const keys = flattenKeys(loadMessages(locale)).sort()

      const missing = reference.filter((key) => !keys.includes(key))
      const extra = keys.filter((key) => !reference.includes(key))

      expect(missing, `clés manquantes en ${locale}`).toEqual([])
      expect(extra, `clés en trop en ${locale}`).toEqual([])
    })

    it(`${locale} n'a aucune valeur vide`, () => {
      const messages = loadMessages(locale)
      const empties: string[] = []

      const walk = (node: unknown, path: string): void => {
        if (typeof node === 'string') {
          if (node.trim() === '') empties.push(path)
          return
        }
        if (node && typeof node === 'object') {
          for (const [key, child] of Object.entries(
            node as Record<string, unknown>,
          )) {
            walk(child, path ? `${path}.${key}` : key)
          }
        }
      }

      walk(messages, '')
      expect(empties).toEqual([])
    })
  }

  it('aucun emoji dans les libellés d’interface', () => {
    // Le brief interdit les emoji dans l'interface, toutes langues confondues.
    const emoji = /\p{Extended_Pictographic}/u
    const offenders: string[] = []

    for (const locale of locales) {
      const walk = (node: unknown, path: string): void => {
        if (typeof node === 'string') {
          if (emoji.test(node)) offenders.push(`${locale}:${path}`)
          return
        }
        if (node && typeof node === 'object') {
          for (const [key, child] of Object.entries(
            node as Record<string, unknown>,
          )) {
            walk(child, path ? `${path}.${key}` : key)
          }
        }
      }
      walk(loadMessages(locale), '')
    }

    expect(offenders).toEqual([])
  })
})

/**
 * Le registre des traitements est une SOURCE, pas un texte.
 *
 * Chaque entrée est rendue sur la page publique de confidentialité par la clé
 * `processing.<key>`. Ajouter un traitement au registre sans ajouter sa
 * traduction affiche la clé brute — sur la page qui, précisément, doit être
 * exacte et lisible.
 *
 * C'est arrivé : le traitement des tunnels de commande abandonnés a été
 * déclaré au registre avant d'exister dans les huit fichiers de messages. Ce
 * test empêche que ça recommence, et il le fait pour TOUTES les entrées, pas
 * seulement celle-là.
 */
describe('registre des traitements', () => {
  it('chaque traitement déclaré a son libellé dans les huit langues', () => {
    const manquantes: string[] = []

    for (const locale of locales) {
      const messages = loadMessages(locale) as {
        privacy?: { processing?: Record<string, unknown>; basis?: Record<string, unknown> }
      }

      for (const processing of PROCESSING_REGISTER) {
        if (!messages.privacy?.processing?.[processing.key]) {
          manquantes.push(`${locale} : privacy.processing.${processing.key}`)
        }
        // La base légale aussi : elle est rendue par `basis.<valeur>`.
        if (!messages.privacy?.basis?.[processing.basis]) {
          manquantes.push(`${locale} : privacy.basis.${processing.basis}`)
        }
      }
    }

    expect(manquantes).toEqual([])
  })

  it('surveille bien quelque chose', () => {
    // Sans ce garde-fou, un registre vide rendrait le test ci-dessus vert.
    expect(PROCESSING_REGISTER.length).toBeGreaterThan(3)
  })
})

/**
 * Le vocabulaire fermé des attributs d'article doit être TRADUIT.
 *
 * `lib/domain/vocabulary.ts` refuse toute valeur hors liste venue de
 * l'application de gestion, précisément parce que chaque valeur acceptée est
 * rendue par un libellé traduit — dans les facettes de filtrage, sur la fiche,
 * et dans la description composée à défaut d'en recevoir une.
 *
 * Ajouter « bleu pétrole » à la liste sans le traduire ferait apparaître
 * `catalogue.colors.bleu-petrole` dans huit catalogues. Ce test attrape
 * l'oubli au moment où il est écrit, pas au premier import.
 */
describe('vocabulaire des attributs', () => {
  const GROUPS = [
    { field: 'colors', values: ARTICLE_COLORS },
    { field: 'materials', values: ARTICLE_MATERIALS },
    { field: 'fits', values: ARTICLE_FITS },
  ] as const

  it('chaque couleur, matière et coupe a son libellé dans les huit langues', () => {
    const manquantes: string[] = []

    for (const locale of locales) {
      const messages = loadMessages(locale) as {
        catalogue?: Record<string, Record<string, unknown> | undefined>
      }

      for (const group of GROUPS) {
        for (const value of group.values) {
          if (!messages.catalogue?.[group.field]?.[value]) {
            manquantes.push(`${locale} : catalogue.${group.field}.${value}`)
          }
        }
      }
    }

    expect(manquantes).toEqual([])
  })

  it('chaque état et chaque clé de mesure a son libellé dans les huit langues', () => {
    const manquantes: string[] = []

    for (const locale of locales) {
      const messages = loadMessages(locale) as {
        condition?: Record<string, { label?: unknown; help?: unknown } | undefined>
        measurement?: { keys?: Record<string, unknown> }
      }

      for (const condition of ARTICLE_CONDITIONS) {
        // Le libellé ET son explication : la description composée utilise les
        // deux, et « état correct » seul ne dit pas ce qu'on achète.
        if (!messages.condition?.[condition]?.label) {
          manquantes.push(`${locale} : condition.${condition}.label`)
        }
        if (!messages.condition?.[condition]?.help) {
          manquantes.push(`${locale} : condition.${condition}.help`)
        }
      }

      for (const key of MEASUREMENT_KEYS) {
        if (!messages.measurement?.keys?.[key]) {
          manquantes.push(`${locale} : measurement.keys.${key}`)
        }
      }
    }

    expect(manquantes).toEqual([])
  })

  it('surveille bien quelque chose', () => {
    expect(ARTICLE_COLORS.length).toBeGreaterThan(3)
    expect(ARTICLE_MATERIALS.length).toBeGreaterThan(3)
    expect(ARTICLE_FITS.length).toBeGreaterThan(3)
    expect(ARTICLE_CONDITIONS.length).toBe(6)
    expect(MEASUREMENT_KEYS.length).toBe(8)
  })
})
