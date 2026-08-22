/**
 * Lecture d'une adresse figée sur une commande.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une lecture défensive
 * ---------------------------------------------------------------------------
 * `Order.shippingAddress` et `Order.billingAddress` sont des colonnes `Json` :
 * elles portent la forme qu'avait le tunnel de commande le jour de l'achat.
 * Rien ne garantit cette forme trois ans plus tard, et une commande de 2026
 * doit rester lisible après n'importe quelle refonte du formulaire.
 *
 * On lit donc champ par champ, en ignorant ce qu'on ne reconnaît pas, et une
 * clé absente devient une ligne absente — jamais un tiret ni un « undefined ».
 *
 * ---------------------------------------------------------------------------
 * Module pur
 * ---------------------------------------------------------------------------
 * Ni `server-only`, ni `'use client'` : la facture le lit côté serveur, le
 * détail de commande aussi, et rien n'interdit qu'un composant client en ait
 * besoin un jour. Le garder dans `invoice.ts`, qui est `server-only`,
 * obligerait à le recopier.
 */

export interface PostalAddress {
  firstName?: string
  lastName?: string
  line1?: string
  line2?: string
  postalCode?: string
  city?: string
  country?: string
}

export function readPostalAddress(value: unknown): PostalAddress {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>

  const text = (key: string): string | undefined =>
    typeof record[key] === 'string' && record[key] !== ''
      ? (record[key] as string)
      : undefined

  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    line1: text('line1'),
    line2: text('line2'),
    postalCode: text('postalCode'),
    city: text('city'),
    country: text('country'),
  }
}

/**
 * L'adresse en lignes affichables, dans l'ordre postal.
 *
 * Aucune ligne vide, aucun séparateur pour combler un trou : une adresse
 * incomplète s'affiche telle qu'elle a été saisie.
 */
export function formatAddressLines(address: PostalAddress): string[] {
  return [
    [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.line1,
    address.line2,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.country,
  ].filter((line): line is string => Boolean(line && line.trim()))
}
