'use server'

import { prisma } from '@/lib/db/client'
import { visibleArticleWhere } from '@/lib/db/visibility'
import { articleIdSchema } from '@/lib/validation/shop'
import { getCurrentUser } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { ensureShopSessionToken, readShopSessionToken } from '@/lib/shop/session-token'

/**
 * Favoris.
 *
 * Deux stockages, une seule sémantique :
 *  - avec compte, la table Favorite ;
 *  - sans compte, GuestFavorite indexée par le jeton de session (cookie
 *    httpOnly), jamais localStorage.
 *
 * Les favoris d'un visiteur sont repris dans son compte à l'inscription comme
 * à la connexion : c'est ce qui rend l'ajout aux favoris utile avant même
 * d'avoir un compte. La reprise elle-même vit dans `favorites-merge.ts`, hors
 * de ce fichier — voir l'avertissement ci-dessous.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Chaque fonction exportée ici reçoit un identifiant stable et devient
 * appelable depuis n'importe quel navigateur, qu'une page s'en serve ou non.
 *
 * Règle : un export = un point d'entrée réseau. Il doit donc valider ses
 * entrées avec Zod, et dériver l'identité de l'appelant de la session — jamais
 * la recevoir en paramètre.
 *
 * `mergeGuestFavorites` violait les deux : elle recevait un identifiant de
 * compte du réseau et écrivait dans les favoris de ce compte, sans vérifier qui
 * appelait. Elle a été déplacée dans un module `server-only`, qui n'expose
 * rien.
 */

/** Identifiants des articles en favori, pour la session courante. */
export async function getFavoriteArticleIds(): Promise<string[]> {
  // Deux requêtes PostgreSQL, appelées à chaque chargement de page portant une
  // grille — et c'est un export de fichier `'use server'`, donc une adresse
  // HTTP appelable directement, en boucle, sans passer par une page.
  //
  // Confort, pas sécurité : une panne du compteur ne doit pas vider les
  // favoris de tout le monde. Sur échec, on renvoie une liste vide plutôt que
  // de laisser remonter une erreur dans le rendu d'une grille.
  const allowed = await checkRateLimit({
    key: `favorites-read:${await clientFingerprint()}`,
    limit: 120,
    windowSeconds: 60,
    sensitive: false,
  })
  if (!allowed) return []

  const user = await getCurrentUser()

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

export interface ToggleFavoriteResult {
  ok: boolean
  isFavorite: boolean
  reason?: 'rate-limited' | 'unknown-article'
}

export async function toggleFavorite(
  articleId: string,
): Promise<ToggleFavoriteResult> {
  // Zod, pas un `if` écrit à la main : c'est la règle du brief, et c'est le
  // même schéma que celui du panier.
  const parsed = articleIdSchema.safeParse(articleId)
  if (!parsed.success) {
    return { ok: false, isFavorite: false, reason: 'unknown-article' }
  }
  const id = parsed.data

  const allowed = await checkRateLimit({
    key: `favorite:${await clientFingerprint()}`,
    limit: 120,
    windowSeconds: 60,
    // Confort : une panne du compteur ne doit pas empêcher de mettre en favori.
    sensitive: false,
  })
  if (!allowed) return { ok: false, isFavorite: false, reason: 'rate-limited' }

  // On ne met en favori que ce qui est réellement consultable : sinon
  // n'importe quel identifiant deviendrait insérable, et on stockerait des
  // renvois vers des fiches introuvables.
  const article = await prisma.article.findFirst({
    where: { id, ...visibleArticleWhere() },
    select: { id: true },
  })
  if (!article) return { ok: false, isFavorite: false, reason: 'unknown-article' }

  const user = await getCurrentUser()

  if (user) {
    const existing = await prisma.favorite.findUnique({
      where: { userId_articleId: { userId: user.id, articleId: id } },
      select: { userId: true },
    })

    if (existing) {
      await prisma.favorite.delete({
        where: { userId_articleId: { userId: user.id, articleId: id } },
      })
      return { ok: true, isFavorite: false }
    }

    await prisma.favorite.create({ data: { userId: user.id, articleId: id } })
    return { ok: true, isFavorite: true }
  }

  const token = await ensureShopSessionToken()
  const existing = await prisma.guestFavorite.findUnique({
    where: { sessionToken_articleId: { sessionToken: token, articleId: id } },
    select: { articleId: true },
  })

  if (existing) {
    await prisma.guestFavorite.delete({
      where: { sessionToken_articleId: { sessionToken: token, articleId: id } },
    })
    return { ok: true, isFavorite: false }
  }

  await prisma.guestFavorite.create({
    data: { sessionToken: token, articleId: id },
  })
  return { ok: true, isFavorite: true }
}
