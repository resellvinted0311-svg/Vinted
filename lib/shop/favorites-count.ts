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

/**
 * Les identifiants des pièces en favoris, pour la même identité déjà résolue.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette lecture rejoint l'état de session
 * ---------------------------------------------------------------------------
 * Les vignettes ont besoin de la LISTE, pas du nombre : chacune doit savoir si
 * son cœur est plein. Cette liste venait jusqu'ici de `getFavoriteArticleIds`,
 * un export de `favorites.ts` — donc une Server Action, donc un aller-retour
 * réseau supplémentaire à chaque chargement de page, qui recommençait le
 * décodage de session que `/api/session` venait de faire.
 *
 * Servie ici, elle voyage avec le reste de l'état de session, dans la même
 * réponse et sur la même identité. Le décompte s'en déduit — `ids.length` —
 * ce qui supprime au passage la requête de comptage : la liste des favoris
 * d'une personne se compte en dizaines, jamais en milliers, et ramener les
 * identifiants coûte moins qu'un aller-retour de plus.
 *
 * La Server Action reste en place : la page « Mes favoris » l'utilise, et elle
 * est le seul chemin possible depuis un formulaire sans JavaScript.
 */
export async function readFavoriteIds(
  user: CurrentUser | null,
): Promise<string[]> {
  if (user) {
    const rows = await prisma.favorite.findMany({
      where: { userId: user.id },
      select: { articleId: true },
    })
    return rows.map((row) => row.articleId)
  }

  const token = await readShopSessionToken()
  if (!token) return []

  const rows = await prisma.guestFavorite.findMany({
    where: { sessionToken: token },
    select: { articleId: true },
  })
  return rows.map((row) => row.articleId)
}
