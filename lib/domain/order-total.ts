/**
 * Totaux d'une commande — pur, et volontairement paranoïaque.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une fonction pour une addition
 * ---------------------------------------------------------------------------
 * Parce que ce n'est pas une addition : c'est le montant qui va être débité
 * d'une carte bancaire, et il doit être égal — au centime — à la somme des
 * lignes envoyées au prestataire de paiement.
 *
 * Un écart d'un centime entre notre total et celui que Stripe recalcule à
 * partir des lignes ne provoque aucune erreur visible : Stripe débite SA somme,
 * et notre base garde la nôtre. La commande est alors fausse dans les livres,
 * la facture ne correspond pas au relevé, et cela se découvre à la
 * comptabilité, des semaines plus tard.
 *
 * D'où l'invariant vérifié ici plutôt que supposé ailleurs.
 */

export interface OrderAmounts {
  subtotalCents: number
  discountCents: number
  shippingCents: number
  totalCents: number
}

export class OrderTotalMismatchError extends Error {
  constructor(expected: number, got: number) {
    super(
      `Total incohérent : les lignes font ${got} centimes, le total annoncé ${expected}.`,
    )
    this.name = 'OrderTotalMismatchError'
  }
}

/**
 * Calcule les montants d'une commande.
 *
 * `discountCents` est un paramètre plutôt qu'un zéro codé en dur : les codes
 * promotionnels arrivent en phase 4, et le jour où ils arriveront, personne
 * n'aura à retrouver toutes les additions éparpillées.
 */
export function computeOrderAmounts(input: {
  itemPricesCents: readonly number[]
  shippingCents: number
  discountCents?: number
}): OrderAmounts {
  const subtotalCents = input.itemPricesCents.reduce((sum, price) => sum + price, 0)
  const discountCents = input.discountCents ?? 0

  // Une remise ne rend jamais une commande négative : elle s'arrête au
  // sous-total. Le port reste dû — l'offrir se décide dans la franchise, pas
  // par débordement d'une remise.
  const appliedDiscount = Math.min(discountCents, subtotalCents)

  return {
    subtotalCents,
    discountCents: appliedDiscount,
    shippingCents: input.shippingCents,
    totalCents: subtotalCents - appliedDiscount + input.shippingCents,
  }
}

/**
 * Vérifie que les lignes envoyées au paiement font bien le total.
 *
 * À appeler juste avant de créer la session de paiement, sur les montants
 * réellement transmis — pas sur ceux dont on croit les avoir déduits.
 */
export function assertLinesMatchTotal(
  lineAmountsCents: readonly number[],
  totalCents: number,
): void {
  const sum = lineAmountsCents.reduce((acc, amount) => acc + amount, 0)
  if (sum !== totalCents) {
    throw new OrderTotalMismatchError(totalCents, sum)
  }
}

/**
 * Répartit un montant entre des lignes, au prorata de leur poids.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette fonction existe
 * ---------------------------------------------------------------------------
 * Le port et la commission de paiement s'appliquent à la COMMANDE : un colis,
 * un encaissement. La remontée de vente vers l'application de gestion, elle,
 * porte sur une PIÈCE. Il faut donc en attribuer une part à chacune.
 *
 * Ce n'est pas un chiffre inventé, mais c'en est une répartition — et elle est
 * annoncée comme telle dans `docs/synchronisation.md`. Ce qu'on garantit, c'est
 * que les parts font exactement le tout : une répartition dont la somme dérive
 * d'un centime fausse la marge cumulée sur des milliers de ventes.
 *
 * ---------------------------------------------------------------------------
 * Plus forts restes, et non arrondi ligne par ligne
 * ---------------------------------------------------------------------------
 * Arrondir chaque part séparément perd ou crée des centimes : 100 centimes sur
 * trois lignes égales donnerait 33 + 33 + 33 = 99. On attribue donc la partie
 * entière à chacun, puis les centimes restants aux lignes dont le reste est le
 * plus grand. C'est la méthode du plus fort reste, celle des répartitions de
 * sièges — pour la même raison : la somme doit tomber juste.
 *
 * Poids tous nuls : on répartit à parts égales. Sans ce cas, une commande dont
 * toutes les pièces seraient offertes ferait une division par zéro.
 */
export function allocateProportionally(
  totalCents: number,
  weights: readonly number[],
): number[] {
  if (weights.length === 0) return []

  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  const effective = sum > 0 ? weights : weights.map(() => 1)
  const effectiveSum = sum > 0 ? sum : weights.length

  const exact = effective.map((weight) => (totalCents * weight) / effectiveSum)
  const floors = exact.map((value) => Math.floor(value))

  let remaining = totalCents - floors.reduce((acc, value) => acc + value, 0)

  // Les restes les plus grands d'abord ; à égalité, la ligne la plus à gauche.
  // Le départage est explicite pour que la répartition soit REPRODUCTIBLE :
  // deux exécutions sur la même commande doivent donner exactement les mêmes
  // parts, sinon une reprise du travail enverrait un second corps différent du
  // premier, et l'application n'aurait plus aucun moyen de les rapprocher.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  const shares = [...floors]
  for (const { index } of order) {
    if (remaining <= 0) break
    shares[index] = (shares[index] ?? 0) + 1
    remaining -= 1
  }

  return shares
}
