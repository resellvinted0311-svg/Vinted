'use server'

import { prisma } from '@/lib/db/client'
import { getCurrentUser } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import {
  ensureShopSessionToken,
  readShopSessionToken,
} from '@/lib/shop/session-token'

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
 * d'avoir un compte.
 */

/** Identifiants des articles en favori, pour la session courante. */
export async function getFavoriteArticleIds(): Promise<string[]> {
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
  if (typeof articleId !== 'string' || articleId.length === 0 || articleId.length > 40) {
    return { ok: false, isFavorite: false, reason: 'unknown-article' }
  }

  const allowed = await checkRateLimit({
    key: `favorite:${await clientFingerprint()}`,
    limit: 120,
    windowSeconds: 60,
    // Confort : une panne du compteur ne doit pas empêcher de mettre en favori.
    sensitive: false,
  })
  if (!allowed) return { ok: false, isFavorite: false, reason: 'rate-limited' }

  // On ne met en favori que ce qui existe et a été publié : sinon n'importe
  // quel identifiant deviendrait insérable.
  const article = await prisma.article.findFirst({
    where: { id: articleId, publishedAt: { not: null } },
    select: { id: true },
  })
  if (!article) return { ok: false, isFavorite: false, reason: 'unknown-article' }

  const user = await getCurrentUser()

  if (user) {
    const existing = await prisma.favorite.findUnique({
      where: { userId_articleId: { userId: user.id, articleId } },
      select: { userId: true },
    })

    if (existing) {
      await prisma.favorite.delete({
        where: { userId_articleId: { userId: user.id, articleId } },
      })
      return { ok: true, isFavorite: false }
    }

    await prisma.favorite.create({ data: { userId: user.id, articleId } })
    return { ok: true, isFavorite: true }
  }

  const token = await ensureShopSessionToken()
  const existing = await prisma.guestFavorite.findUnique({
    where: { sessionToken_articleId: { sessionToken: token, articleId } },
    select: { articleId: true },
  })

  if (existing) {
    await prisma.guestFavorite.delete({
      where: { sessionToken_articleId: { sessionToken: token, articleId } },
    })
    return { ok: true, isFavorite: false }
  }

  await prisma.guestFavorite.create({
    data: { sessionToken: token, articleId },
  })
  return { ok: true, isFavorite: true }
}

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
