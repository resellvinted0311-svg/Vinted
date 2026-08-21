import { describe, it, expect } from 'vitest'
import { isSafeInternalPath, stripLocalePrefix } from '@/lib/security/safe-path'
import { locales } from '@/lib/i18n/routing'

/**
 * La reprise après connexion prend son chemin dans l'URL. Donc de
 * l'extérieur : `?suite=…` se fabrique et s'envoie à une victime.
 */

describe('chemin de reprise', () => {
  it('accepte un chemin interne ordinaire', () => {
    for (const path of ['/compte', '/compte/donnees', '/catalogue?tri=prix']) {
      expect(isSafeInternalPath(path), path).toBe(true)
    }
  })

  it('refuse une redirection ouverte à protocole relatif', () => {
    // C'est le défaut corrigé : `startsWith('/')` laissait passer celui-ci,
    // que le navigateur lit comme une URL absolue. Redirection vers un site
    // tiers depuis la page où l'on vient de taper son mot de passe.
    expect(isSafeInternalPath('//evil.example')).toBe(false)
    expect(isSafeInternalPath('///evil.example')).toBe(false)
  })

  it('refuse la contre-oblique, que les navigateurs lisent comme une barre', () => {
    expect(isSafeInternalPath('/\\evil.example')).toBe(false)
  })

  it('refuse une URL absolue', () => {
    for (const value of [
      'https://evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>',
    ]) {
      expect(isSafeInternalPath(value), value).toBe(false)
    }
  })

  it('refuse le vide et l’absent', () => {
    expect(isSafeInternalPath(null)).toBe(false)
    expect(isSafeInternalPath(undefined)).toBe(false)
    expect(isSafeInternalPath('')).toBe(false)
    expect(isSafeInternalPath('compte')).toBe(false)
  })

  it('refuse un chemin démesuré', () => {
    expect(isSafeInternalPath(`/${'a'.repeat(600)}`)).toBe(false)
  })
})

describe('préfixe de langue', () => {
  it('le retire quand il est là', () => {
    // Sans cela, le routeur le remettait : `/fr/compte` devenait
    // `/fr/fr/compte`, donc une 404. La reprise ne marchait jamais.
    expect(stripLocalePrefix('/fr/compte', locales)).toBe('/compte')
    expect(stripLocalePrefix('/en/compte/donnees', locales)).toBe(
      '/compte/donnees',
    )
  })

  it('ramène la racine à une barre', () => {
    expect(stripLocalePrefix('/fr', locales)).toBe('/')
  })

  it('laisse intact ce qui ne commence pas par une langue connue', () => {
    expect(stripLocalePrefix('/compte', locales)).toBe('/compte')
    // « xx » n'est pas une des huit langues : on ne coupe pas au hasard.
    expect(stripLocalePrefix('/xx/compte', locales)).toBe('/xx/compte')
  })

  it('ne produit jamais un chemin dangereux', () => {
    for (const path of ['/fr', '/fr/', '/fr/compte', '/compte']) {
      expect(isSafeInternalPath(stripLocalePrefix(path, locales)), path).toBe(
        true,
      )
    }
  })
})
