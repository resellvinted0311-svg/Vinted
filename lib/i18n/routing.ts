import { defineRouting } from 'next-intl/routing'

/**
 * Langues servies.
 *
 * La Belgique n'est pas une langue : elle est couverte par fr, nl et de.
 * La devise reste l'euro partout en V1, Pologne comprise.
 */
export const locales = ['fr', 'en', 'es', 'it', 'nl', 'de', 'pt', 'pl'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'fr'

/** Nom de chaque langue dans sa propre langue, pour le sélecteur. */
export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  de: 'Deutsch',
  pt: 'Português',
  pl: 'Polski',
}

/**
 * Correspondance langue → balise BCP 47 complète, pour les attributs hreflang
 * et le formatage des nombres et des dates.
 */
export const localeTags: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  it: 'it-IT',
  nl: 'nl-NL',
  de: 'de-DE',
  pt: 'pt-PT',
  pl: 'pl-PL',
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Préfixe systématique, y compris pour le français : une URL sans préfixe
  // n'existe pas, ce qui évite tout contenu dupliqué côté référencement.
  localePrefix: 'always',
  localeDetection: true,
  localeCookie: {
    name: 'ND_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  },
})

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}
