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
  // La langue est déduite de l'en-tête `Accept-Language` à chaque requête.
  // Une lecture d'en-tête ne stocke rien sur l'appareil : elle ne relève donc
  // pas du consentement.
  localeDetection: true,

  /**
   * AUCUN cookie de langue. C'est un choix, et il a un prix.
   *
   * Un cookie de préférence linguistique n'échappe au consentement que s'il
   * résulte d'un CHOIX EXPLICITE. Celui qui était posé ici ne l'était pas : la
   * seule lecture de l'en-tête du navigateur suffisait à déposer un
   * identifiant de douze mois chez tout visiteur, y compris quelqu'un qui
   * n'avait jamais touché au sélecteur de langue.
   *
   * Or ce site n'a aujourd'hui aucun script tiers, aucune mesure d'audience,
   * aucune requête sortante depuis le navigateur — les polices sont
   * auto-hébergées. Il n'a donc besoin d'AUCUN bandeau de consentement, ce qui
   * est un vrai avantage : ni écran d'accueil à cliquer, ni dégradation des
   * Core Web Vitals, ni registre de consentements à tenir. Ce cookie-là était
   * la seule chose qui menaçait cette propriété, pour un bénéfice mince.
   *
   * Ce qu'on perd : une personne dont le navigateur est en anglais mais qui a
   * choisi le néerlandais retombera sur l'anglais si elle revient par l'URL
   * racine. Le préfixe d'URL porte le choix partout ailleurs — dans ses
   * favoris, dans son historique, dans un lien partagé — donc le cas est
   * étroit. Il ne vaut pas un bandeau.
   */
  localeCookie: false,
})

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}
