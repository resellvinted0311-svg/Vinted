'use server'

import { revalidatePath } from 'next/cache'
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

/**
 * Purge le cache de rendu des pages qui affichent le panier.
 *
 * L'en-tête porte le compteur sur CHAQUE page : sans cette invalidation, un
 * ajout depuis une fiche article laisse un « 0 » affiché tant que la page n'est
 * pas rechargée à la main. `layout` invalide la mise en page elle-même, donc
 * toutes les routes qu'elle enveloppe.
 */
function refreshCartViews(): void {
  revalidatePath('/', 'layout')
}

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

  const result = await addToCart(articleId)
  if (result.ok) refreshCartViews()
  return result
}

export async function removeFromCartAction(
  articleId: string,
): Promise<CartMutationResult> {
  if (!(await allowCartWrite())) return RATE_LIMITED

  const result = await removeFromCart(articleId)
  if (result.ok) refreshCartViews()
  return result
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

  const result = await removeBlockedLines(articleIds)
  if (result.ok) refreshCartViews()
  return result
}
