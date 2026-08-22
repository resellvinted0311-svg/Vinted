'use client'

/**
 * Signal « le panier a changé », entre composants clients.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un événement plutôt qu'un état partagé
 * ---------------------------------------------------------------------------
 * Le compteur vit dans l'en-tête, rendu par la mise en page ; les boutons qui
 * modifient le panier vivent dans les pages. Un contexte React commun aux deux
 * obligerait à rendre la mise en page dynamique, ce qui coûterait le rendu
 * statique de l'accueil, du catalogue et des fiches article — c'est-à-dire les
 * pages qui portent le référencement.
 *
 * ---------------------------------------------------------------------------
 * Le nombre transmis n'est pas la source de vérité
 * ---------------------------------------------------------------------------
 * Il vient du serveur, qui vient de compter les lignes. Il sert à rafraîchir
 * l'affichage sans attendre un aller-retour de plus. Le compteur se resynchro-
 * nise de toute façon sur `/api/session` au prochain chargement : rien ici
 * n'est jamais additionné ni soustrait côté navigateur, parce qu'un décompte
 * tenu dans le navigateur finit toujours par diverger de la base.
 */

export const CART_CHANGED_EVENT = 'nd:cart-changed'

export interface CartChangedDetail {
  count: number
}

export function notifyCartChanged(count: number): void {
  window.dispatchEvent(
    new CustomEvent<CartChangedDetail>(CART_CHANGED_EVENT, {
      detail: { count },
    }),
  )
}
