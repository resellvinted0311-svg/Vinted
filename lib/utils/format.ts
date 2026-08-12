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

/** Mesure en centimètres, sans décimale superflue. */
export function formatCm(value: number, locale: string): string {
  const tag = localeTags[locale as Locale] ?? localeTags.fr
  const formatted = new Intl.NumberFormat(tag, {
    maximumFractionDigits: 1,
  }).format(value)
  return `${formatted} cm`
}
