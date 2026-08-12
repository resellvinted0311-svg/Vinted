import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { locales } from '@/lib/i18n/routing'

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
