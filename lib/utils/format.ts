import { localeTags, type Locale } from '@/lib/i18n/routing'

/**
 * Formatage des montants.
 *
 * Toujours depuis des centiers entiers : on ne manipule jamais un prix en
 * nombre à virgule flottante avant l'affichage.
 */
export function formatPrice(cents: number, locale: string): string {
  const tag = localeTags[locale as Locale] ?? localeTags.fr

  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Pourcentage de remise entre un prix barré et le prix courant. */
export function discountPercent(
  priceCents: number,
  comparePriceCents: number | null,
): number | null {
  if (!comparePriceCents || comparePriceCents <= priceCents) return null
  return Math.round(((comparePriceCents - priceCents) / comparePriceCents) * 100)
}

export function formatDate(date: Date, locale: string): string {
  const tag = localeTags[locale as Locale] ?? localeTags.fr
  return new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(date)
}

/**
 * Poids expédié.
 *
 * Affiché sur la vignette et la fiche : c'est une donnée d'inventaire réelle,
 * qui sert aussi au calcul du port. En grammes en dessous du kilo, en
 * kilogrammes au-delà — personne ne lit « 1 250 g » sans convertir.
 */
export function formatGrams(grams: number, locale: string): string {
  const tag = localeTags[locale as Locale] ?? localeTags.fr

  if (grams < 1000) {
    return `${new Intl.NumberFormat(tag).format(grams)} g`
  }

  const formatted = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(grams / 1000)

  return `${formatted} kg`
}

/** Mesure en centimètres, sans décimale superflue. */
export function formatCm(value: number, locale: string): string {
  const tag = localeTags[locale as Locale] ?? localeTags.fr
  const formatted = new Intl.NumberFormat(tag, {
    maximumFractionDigits: 1,
  }).format(value)
  return `${formatted} cm`
}
