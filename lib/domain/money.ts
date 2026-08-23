/**
 * Lecture d'un montant saisi à la main.
 *
 * Pur, sans base ni requête : c'est une conversion de texte, et elle se teste
 * exhaustivement.
 */

/**
 * « 32,50 » ou « 32.50 » → 3250 centimes.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas `Math.round(Number(value) * 100)`
 * ---------------------------------------------------------------------------
 * Parce que `32.50 * 100` vaut 3250.0000000000005 en virgule flottante.
 * `Math.round` rattrape ce cas-là, mais la forme laisse entrer un flottant
 * dans un calcul de prix — ce que `lib/domain/pricing.ts` interdit en tête de
 * fichier, et pour de bonnes raisons.
 *
 * On lit donc la partie entière et les décimales SÉPARÉMENT, comme deux
 * entiers, et on les recompose. Aucun flottant n'apparaît.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi refuser plutôt que deviner
 * ---------------------------------------------------------------------------
 * « 32,5,0 », « 32 50 », « environ 32 » ne sont pas des montants. En lire une
 * partie ferait proposer un prix que personne n'a saisi — et sur un formulaire
 * d'offre, ce prix engage.
 *
 * Renvoie `NaN`, que la validation Zod en amont rejette ensuite. Une valeur de
 * repli — zéro, le prix affiché — serait pire : elle passerait.
 */
export function parseAmountToCents(value: string): number {
  // La virgule est le séparateur décimal de sept des huit langues du site ; le
  // point est celui de la huitième et des claviers numériques. Les deux se
  // saisissent, les deux se lisent.
  const normalized = value.trim().replace(',', '.')

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN

  const [whole = '0', decimals = ''] = normalized.split('.')

  // `padEnd` et non `padStart` : « 32.5 » fait 32,50 € et non 32,05 €.
  return Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
}
