/**
 * État des lignes de panier — fonctions pures, sans base ni horloge implicite.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une ligne de panier n'est jamais supprimée
 * ---------------------------------------------------------------------------
 * Sur un stock unitaire, une pièce peut devenir indisponible entre le moment où
 * elle entre dans un panier et celui où on le rouvre. La tentation est de
 * retirer la ligne : le total redevient juste, le tunnel reste propre.
 *
 * Le brief l'interdit, et c'est juste. Une ligne qui disparaît sans un mot
 * ressemble à un bogue, et arrive au pire moment — celui où l'on s'apprête à
 * payer. La cliente doit voir ce qu'elle avait choisi, apprendre ce qui lui est
 * arrivé, et décider elle-même de le retirer.
 *
 * Ce module ne fait donc que QUALIFIER chaque ligne. Il ne supprime rien, ne
 * décide rien : il produit un état que l'interface affiche et que le serveur
 * consulte pour savoir ce qui est encore achetable.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `now` est un paramètre
 * ---------------------------------------------------------------------------
 * Une expiration de réservation se teste au bord d'une seconde. Une fonction
 * qui lit l'horloge elle-même ne se teste pas à la seconde près — et surtout,
 * deux lignes du même panier évaluées à deux instants différents pourraient se
 * contredire.
 */

/** Statuts d'article, repris de l'enum Prisma sans en dépendre. */
export type ArticleStatusLike =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'SOLD'
  | 'ARCHIVED'

/**
 * État d'une ligne.
 *
 * Une variation de prix n'empêche PAS d'acheter — elle s'affiche, et c'est le
 * prix courant qui fait foi. Bloquer sur une baisse de prix serait absurde, et
 * la boutique baisse ses prix automatiquement avec le temps.
 */
export type CartLineState =
  | { kind: 'ok' }
  | { kind: 'price-lowered'; snapshotCents: number; currentCents: number }
  | { kind: 'price-raised'; snapshotCents: number; currentCents: number }
  | { kind: 'reserved-by-other'; until: Date | null }
  | { kind: 'sold' }
  | { kind: 'unavailable' }

/** Ce qu'il faut savoir d'un article pour qualifier sa ligne. */
export interface CartLineFacts {
  /** Prix mémorisé à l'ajout. Sert UNIQUEMENT à détecter un écart. */
  snapshotUnitPriceCents: number
  /** Prix actuel en base. C'est lui qui fait foi, toujours. */
  currentPriceCents: number
  status: ArticleStatusLike
  publishedAt: Date | null
  /** Propriétaire du verrou de stock, s'il existe. */
  reservedById: string | null
  reservedUntil: Date | null
  /**
   * Propriétaire du panier qu'on regarde : identifiant de compte ou jeton de
   * session. Une pièce que J'AI réservée n'est pas « prise par quelqu'un
   * d'autre » — c'est mon propre paiement en cours.
   */
  viewerLockOwnerId: string
  now: Date
}

/** Une réservation encore valide à l'instant considéré ? */
function lockIsLive(reservedUntil: Date | null, now: Date): boolean {
  // Sans échéance, le verrou est considéré comme mort : une contrainte CHECK
  // interdit déjà cette combinaison en base, mais une donnée incohérente ne
  // doit pas bloquer une vente.
  if (!reservedUntil) return false
  return reservedUntil.getTime() > now.getTime()
}

/**
 * Qualifie une ligne de panier.
 *
 * L'ordre des tests compte : « vendu » l'emporte sur tout le reste, et une
 * indisponibilité l'emporte sur un écart de prix. Afficher « le prix a baissé »
 * sur une pièce déjà partie serait une mauvaise plaisanterie.
 */
export function evaluateCartLine(facts: CartLineFacts): CartLineState {
  if (facts.status === 'SOLD') return { kind: 'sold' }

  if (
    facts.status === 'DRAFT' ||
    facts.status === 'SCHEDULED' ||
    facts.status === 'ARCHIVED' ||
    facts.publishedAt === null ||
    facts.publishedAt.getTime() > facts.now.getTime()
  ) {
    return { kind: 'unavailable' }
  }

  if (facts.status === 'RESERVED') {
    const live = lockIsLive(facts.reservedUntil, facts.now)
    const mine = facts.reservedById === facts.viewerLockOwnerId

    // Réservée par quelqu'un d'autre, et le verrou tient encore : la ligne
    // reste visible mais n'est pas achetable. Un verrou expiré n'est pas un
    // obstacle — le balayage ne l'a simplement pas encore libéré.
    if (live && !mine) {
      return { kind: 'reserved-by-other', until: facts.reservedUntil }
    }
  }

  if (facts.currentPriceCents < facts.snapshotUnitPriceCents) {
    return {
      kind: 'price-lowered',
      snapshotCents: facts.snapshotUnitPriceCents,
      currentCents: facts.currentPriceCents,
    }
  }

  if (facts.currentPriceCents > facts.snapshotUnitPriceCents) {
    return {
      kind: 'price-raised',
      snapshotCents: facts.snapshotUnitPriceCents,
      currentCents: facts.currentPriceCents,
    }
  }

  return { kind: 'ok' }
}

/** Une ligne dans cet état peut-elle être payée ? */
export function isPurchasable(state: CartLineState): boolean {
  return (
    state.kind === 'ok' ||
    state.kind === 'price-lowered' ||
    state.kind === 'price-raised'
  )
}

/** Une ligne dans cet état demande-t-elle une décision de la cliente ? */
export function needsAttention(state: CartLineState): boolean {
  return state.kind !== 'ok'
}

/**
 * Sous-total des seules lignes achetables, au prix COURANT.
 *
 * Le prix mémorisé à l'ajout n'entre jamais dans un total : c'est un témoin
 * d'écart, pas une valeur monétaire. S'en servir laisserait payer le prix
 * d'hier une pièce dont le prix a changé — dans un sens comme dans l'autre.
 */
export function computeCartSubtotalCents(
  lines: readonly { currentPriceCents: number; state: CartLineState }[],
): number {
  return lines
    .filter((line) => isPurchasable(line.state))
    .reduce((sum, line) => sum + line.currentPriceCents, 0)
}

/** Poids des seules lignes achetables — le reste ne part pas dans le colis. */
export function purchasableWeightsGrams(
  lines: readonly { weightGrams: number; state: CartLineState }[],
): number[] {
  return lines
    .filter((line) => isPurchasable(line.state))
    .map((line) => line.weightGrams)
}

export interface CartTally {
  /** Lignes présentes, toutes qualifications confondues. */
  total: number
  /** Lignes réellement payables. */
  purchasable: number
  /** Lignes qui demandent une décision. */
  blocked: number
  subtotalCents: number
}

/**
 * Décompte d'un panier.
 *
 * `blocked` sert à décider si le tunnel peut s'ouvrir : on ne laisse pas
 * quelqu'un entrer dans un paiement avec une ligne qu'il n'a pas encore vue
 * devenir indisponible.
 */
export function tallyCart(
  lines: readonly { currentPriceCents: number; state: CartLineState }[],
): CartTally {
  const purchasable = lines.filter((line) => isPurchasable(line.state))

  return {
    total: lines.length,
    purchasable: purchasable.length,
    blocked: lines.length - purchasable.length,
    subtotalCents: computeCartSubtotalCents(lines),
  }
}

/**
 * Le tunnel de commande peut-il s'ouvrir ?
 *
 * Deux conditions, et elles sont celles du serveur, pas celles de l'écran :
 * `prepareCheckoutFor` refuse le panier ENTIER dès qu'une seule ligne n'est
 * plus payable, et refuse un panier vide.
 *
 * La règle vit ici — module pur, testable — plutôt que dans le JSX du bouton.
 * Écrite dans un composant, elle aurait fini par diverger de celle du serveur,
 * et la divergence se serait vue sous la forme d'un bouton qui mène à une
 * erreur.
 *
 * Un panier bloqué n'est PAS une raison de retirer les lignes fautives : elles
 * restent affichées, nommées, et la personne décide.
 */
export function canOpenCheckout(tally: CartTally): boolean {
  return tally.purchasable > 0 && tally.blocked === 0
}
