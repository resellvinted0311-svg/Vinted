import 'server-only'

import { prisma } from '@/lib/db/client'
import type { CurrentUser } from '@/lib/auth/session'
import { readShopSessionToken } from '@/lib/shop/session-token'

/**
 * Combien de pièces sont en favoris — le nombre, et rien d'autre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce n'est PAS dans `favorites.ts`
 * ---------------------------------------------------------------------------
 * Ce fichier-là porte `'use server'` : chacun de ses exports devient une
 * Server Action, c'est-à-dire une adresse HTTP appelable directement, en
 * boucle, par n'importe qui. Y ajouter une fonction qui prend un objet
 * `utilisateur` en paramètre serait une faute franche — la personne appelante
 * choisirait alors de qui elle lit les favoris.
 *
 * Ce module est en `server-only` : il ne s'expose pas, il se lit depuis un
 * gestionnaire de route qui a d'abord établi l'identité. Le panier suit
 * exactement la même séparation, pour la même raison.
 *
 * ---------------------------------------------------------------------------
 * L'identité est PASSÉE, pas relue
 * ---------------------------------------------------------------------------
 * `getCurrentUser` est mémorisée par le `cache()` de React, mais cette
 * mémorisation ne s'applique pas dans un gestionnaire de route : la relire ici
 * décoderait la session une seconde fois à chaque chargement de page du site.
 * C'est la mesure qui a conduit `readCartCount` à prendre son propriétaire en
 * argument ; on ne refait pas l'erreur à côté.
 */
export async function readFavoriteCount(
  /**
   * L'identité déjà résolue. `null` signifie « visiteur sans compte » : on
   * retombe alors sur le jeton de session, qui est ce qui porte les favoris
   * d'un invité pendant trente jours.
   */
  user: CurrentUser | null,
): Promise<number> {
  if (user) {
    return prisma.favorite.count({ where: { userId: user.id } })
  }

  const token = await readShopSessionToken()
  // Pas de jeton : aucune visite n'a encore rien déposé. Zéro, sans toucher à
  // la base — c'est le cas de la toute première page vue par la plupart des
  // gens, et il ne doit rien coûter.
  if (!token) return 0

  return prisma.guestFavorite.count({ where: { sessionToken: token } })
}
