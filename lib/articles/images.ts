import 'server-only'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/db/client'
import { normalizeImage } from '@/lib/sync/images'
import { storeImage } from '@/lib/providers/storage'
import { MAX_IMAGES } from '@/lib/validation/sync'

/**
 * Les photos d'une pièce, ajoutées et corrigées depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la suppression et le réordonnancement sont du MÊME lot
 * ---------------------------------------------------------------------------
 * La première photo EST la vignette du catalogue. Si la boutiquière téléverse
 * d'abord la photo de l'étiquette, ou une photo floue, et qu'aucun geste ne
 * permet de la retirer ni de la déplacer, elle peut vendre mais pas se
 * corriger — sans console SQL. Un écran qui ne sait qu'ajouter n'est pas un
 * écran d'administration.
 *
 * ---------------------------------------------------------------------------
 * Rien n'est écrit tant que l'octet n'est pas chez l'hébergeur
 * ---------------------------------------------------------------------------
 * L'identifiant est tiré AVANT le téléversement et sert de nom de fichier chez
 * l'hébergeur. C'est ce qui permet une insertion unique, après coup.
 *
 * L'ordre inverse — insérer une ligne, téléverser, puis la compléter — laisse
 * au moindre échec une ligne `ArticleImage` à URL vide. Or la mise en vente
 * compte les lignes pour vérifier qu'une pièce a bien une photo : la fiche
 * partirait en ligne avec une vignette cassée, ce qui est pire que pas de
 * fiche du tout.
 *
 * ---------------------------------------------------------------------------
 * Les contrôles de sécurité ne sont pas réécrits
 * ---------------------------------------------------------------------------
 * `normalizeImage` est celle de la synchronisation : reniflage du type MIME
 * RÉEL par les octets d'en-tête et jamais par l'extension, garde-fou contre la
 * bombe à décompression appliqué PENDANT le décodage, bornes de dimensions, et
 * suppression des métadonnées par ré-encodage — les coordonnées GPS du lieu de
 * la photo, souvent le domicile, ne survivent pas à l'opération.
 */

export type ImageRefusal =
  | 'not-found'
  | 'too-many'
  | 'rejected'
  | 'storage-unavailable'

export type AddImageResult =
  | { ok: true; imageId: string; url: string; position: number }
  | { ok: false; reason: ImageRefusal; detail?: string }

export async function addArticleImage(
  articleId: string,
  data: Buffer,
): Promise<AddImageResult> {
  const article = await prisma.article.findFirst({
    where: { id: articleId, externalId: null },
    select: { id: true, sku: true, _count: { select: { images: true } } },
  })
  if (!article) return { ok: false, reason: 'not-found' }

  // Le contrat annonce dix visuels par pièce. La borne vaut ici aussi : elle
  // protège l'affichage autant que le stockage.
  if (article._count.images >= MAX_IMAGES) {
    return { ok: false, reason: 'too-many' }
  }

  let normalized
  try {
    normalized = await normalizeImage(data)
  } catch (error) {
    // Le motif est rendu à la boutiquière : « refusé » sans raison la laisse
    // rééssayer la même photo indéfiniment.
    return {
      ok: false,
      reason: 'rejected',
      detail: error instanceof Error ? error.message : undefined,
    }
  }

  const imageId = randomUUID()

  let stored
  try {
    stored = await storeImage({
      data: normalized.data,
      contentType: normalized.contentType,
      folder: `articles/${article.sku}`,
      publicId: imageId,
    })
  } catch {
    return { ok: false, reason: 'storage-unavailable' }
  }

  // Position calculée DANS la transaction, à partir du maximum réel : un
  // comptage relu puis inséré se court après lui-même sur un double envoi, et
  // deux lignes à la même position font basculer la vignette d'un rendu à
  // l'autre.
  return prisma.$transaction(async (tx) => {
    const last = await tx.articleImage.aggregate({
      where: { articleId },
      _max: { position: true },
    })
    const position = (last._max.position ?? -1) + 1

    await tx.articleImage.create({
      data: {
        id: imageId,
        articleId,
        url: stored.url,
        width: stored.width,
        height: stored.height,
        // Miniature d'attente, produite au ré-encodage. Sans elle, la colonne
        // reste nulle et `placeholder="blur"` retombe silencieusement sur
        // `empty` : la vignette apparaît d'un coup sur un aplat de couleur.
        blurhash: normalized.placeholder,
        position,
      },
    })

    return { ok: true as const, imageId, url: stored.url, position }
  })
}

export type ImageOrderAction = 'remove' | 'up' | 'down'

export type ImageOrderResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'no-move' }

/**
 * Supprime une photo, ou la déplace d'un cran.
 *
 * ---------------------------------------------------------------------------
 * Les positions sont RENUMÉROTÉES, jamais laissées trouées
 * ---------------------------------------------------------------------------
 * Après une suppression, une numérotation 0, 2, 3 fonctionne — le tri reste
 * juste — mais elle rend le déplacement fragile : « monter » n'est plus
 * « position − 1 ». On réécrit donc la suite entière dans la même transaction,
 * comme le fait déjà le réhébergement des visuels importés.
 *
 * ---------------------------------------------------------------------------
 * Le fichier reste chez l'hébergeur, et c'est assumé
 * ---------------------------------------------------------------------------
 * Supprimer la LIGNE suffit à corriger la fiche. L'actif orphelin est un coût
 * de stockage, pas un défaut d'affichage — et le supprimer demanderait un appel
 * signé de plus, qui peut échouer après que la ligne est partie. Dette
 * explicite, à reprendre le jour où le volume le justifie.
 */
export async function reorderArticleImage(
  imageId: string,
  action: ImageOrderAction,
): Promise<ImageOrderResult> {
  const image = await prisma.articleImage.findFirst({
    where: { id: imageId, article: { externalId: null } },
    select: { id: true, articleId: true, position: true },
  })
  if (!image) return { ok: false, reason: 'not-found' }

  return prisma.$transaction(async (tx) => {
    const all = await tx.articleImage.findMany({
      where: { articleId: image.articleId },
      orderBy: { position: 'asc' },
      select: { id: true },
    })

    const index = all.findIndex((row) => row.id === imageId)
    if (index === -1) return { ok: false as const, reason: 'not-found' as const }

    const ordered = all.map((row) => row.id)

    if (action === 'remove') {
      ordered.splice(index, 1)
      await tx.articleImage.delete({ where: { id: imageId } })
    } else {
      const target = action === 'up' ? index - 1 : index + 1

      // Déjà en tête, ou déjà en queue : rien à faire, et le dire plutôt que de
      // renuméroter pour rien.
      if (target < 0 || target >= ordered.length) {
        return { ok: false as const, reason: 'no-move' as const }
      }

      const moved = ordered[index] as string
      ordered[index] = ordered[target] as string
      ordered[target] = moved
    }

    // Renumérotation complète : voir l'en-tête.
    for (const [position, id] of ordered.entries()) {
      await tx.articleImage.update({ where: { id }, data: { position } })
    }

    return { ok: true as const }
  })
}
