'use server'

import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import {
  addToCart,
  removeFromCart,
  removeBlockedLines,
  type CartMutationResult,
} from '@/lib/shop/cart'

/**
 * Panier : les seules écritures ouvertes au navigateur.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. `lib/shop/cart.ts` exporte aussi `mergeGuestCart(userId)`, qui écrit
 * dans le panier du compte dont elle reçoit l'identifiant — exposer ce fichier
 * tel quel donnerait à n'importe qui le droit de vider le panier d'autrui. Ce
 * module ne relaie donc que les trois écritures qui dérivent leur identité de
 * la session, et rien d'autre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une couche de plus
 * ---------------------------------------------------------------------------
 * Elle porte ce qui appartient à la frontière réseau et non au métier : le
 * comptage d'appels, et l'invalidation du rendu. `cart.ts` reste `server-only`
 * et testable sans requête.
 */

/*
 * ---------------------------------------------------------------------------
 * Il y avait ici un `revalidatePath('/', 'layout')`. Il a été RETIRÉ.
 * ---------------------------------------------------------------------------
 * Sa justification écrite était : « l'en-tête porte le compteur sur chaque
 * page, sans cette invalidation un ajout laisse un 0 affiché ». Elle était
 * fausse, et le code le disait déjà :
 *
 *  - `CartCountBadge` est un composant CLIENT. Il lit `/api/session` après
 *    hydratation et se met à jour sur l'événement `notifyCartChanged` — son
 *    propre en-tête explique que lire le panier au rendu « rendrait toutes ces
 *    pages dynamiques » ;
 *  - la page panier est `force-dynamic` : rien n'y est mis en cache ;
 *  - `CartRemoveButton` et `BlockedLinesNotice` appellent déjà
 *    `router.refresh()` là où une relecture serveur compte.
 *
 * Ce que l'invalidation faisait, en revanche, était réel : `layout` purge TOUT
 * ce que la mise en page racine enveloppe, soit les 171 pages prérendues. Et
 * elle était déclenchable par n'importe qui, sans compte, sans cookie et sans
 * panier — `removeBlockedLines([])` sort sur `parsed.data.length === 0` avec
 * `{ ok: true }` AVANT le moindre accès à la base, et l'action invalidait sur
 * `result.ok`.
 *
 * Le seul frein était le compteur ci-dessous, à soixante par minute et par
 * empreinte, déclaré `sensitive: false` — donc ouvert en cas de panne du
 * compteur, panne qu'un attaquant peut provoquer lui-même en épuisant le quota.
 * Soixante purges complètes par minute et par adresse, contre un pool réglé à
 * UNE connexion par instance : le catalogue n'était plus jamais servi depuis le
 * cache.
 *
 * Leçon générale : n'invalider que ce qui dépend réellement de ce qu'on vient
 * d'écrire, et jamais depuis un chemin qui n'a rien écrit.
 */

/** Comptage commun aux trois écritures. */
async function allowCartWrite(): Promise<boolean> {
  return checkRateLimit({
    key: `cart-write:${await clientFingerprint()}`,
    limit: 60,
    windowSeconds: 60,
    // Confort, pas sécurité : le panier ne verrouille aucun stock et n'engage
    // aucun paiement. Une panne du compteur ne doit pas empêcher d'acheter.
    // Le chemin qui compte vraiment — l'ouverture du paiement — est compté
    // séparément, et lui ferme la porte en cas de panne.
    sensitive: false,
  })
}

const RATE_LIMITED: CartMutationResult = { ok: false, reason: 'rate-limited' }

export async function addToCartAction(
  articleId: string,
): Promise<CartMutationResult> {
  if (!(await allowCartWrite())) return RATE_LIMITED

  return addToCart(articleId)
}

export async function removeFromCartAction(
  articleId: string,
): Promise<CartMutationResult> {
  if (!(await allowCartWrite())) return RATE_LIMITED

  return removeFromCart(articleId)
}

/**
 * Retire les lignes devenues impayables, sur demande explicite.
 *
 * Le bouton qui appelle ceci NOMME les pièces concernées. C'est la seule façon
 * de vider ce qui bloque sans retirer une ligne en silence — ce que le cahier
 * des charges interdit.
 */
export async function removeBlockedLinesAction(
  articleIds: string[],
): Promise<CartMutationResult> {
  if (!(await allowCartWrite())) return RATE_LIMITED

  return removeBlockedLines(articleIds)
}
