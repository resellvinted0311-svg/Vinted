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
