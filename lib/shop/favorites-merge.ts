import 'server-only'

import { prisma } from '@/lib/db/client'
import { readShopSessionToken } from '@/lib/shop/session-token'

/**
 * Reprise des favoris d'un visiteur dans son compte.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier existe
 * ---------------------------------------------------------------------------
 * Cette fonction vivait dans `favorites.ts`, marqué `'use server'`. Or ce
 * marqueur ne protège rien : il rend PUBLIC tout ce que le fichier exporte.
 * `mergeGuestFavorites` était donc une adresse HTTP appelable par n'importe
 * qui, recevant un identifiant de compte **directement du réseau** et écrivant
 * dans les favoris de ce compte — sans vérifier qui appelait, sans valider quoi
 * que ce soit.
 *
 * `import 'server-only'` fait l'inverse : le module ne peut être importé que
 * depuis du code serveur, et n'expose aucune adresse. La fonction n'est plus
 * joignable que par les actions d'authentification, qui, elles, connaissent
 * l'identité réelle de l'appelant parce qu'elles viennent de l'établir.
 */
/**
 * Reprend les favoris d'un visiteur dans son compte.
 *
 * Appelée à l'inscription et à la connexion. `skipDuplicates` évite d'échouer
 * si l'article est déjà en favori sur le compte — cas courant quand quelqu'un
 * se reconnecte depuis un navigateur déjà utilisé.
 */
export async function mergeGuestFavorites(userId: string): Promise<number> {
  const token = await readShopSessionToken()
  if (!token) return 0

  const guestRows = await prisma.guestFavorite.findMany({
    where: { sessionToken: token },
    select: { articleId: true },
  })
  if (guestRows.length === 0) return 0

  const result = await prisma.favorite.createMany({
    data: guestRows.map((row) => ({ userId, articleId: row.articleId })),
    skipDuplicates: true,
  })

  await prisma.guestFavorite.deleteMany({ where: { sessionToken: token } })

  return result.count
}
