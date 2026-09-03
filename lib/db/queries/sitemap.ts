import 'server-only'

import { prisma } from '@/lib/db/client'
import { visibleArticleWhere, LISTED_STATUSES } from '@/lib/db/visibility'

/**
 * Ce que le plan de site doit connaître, et rien d'autre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ces requêtes ne réutilisent pas celles du catalogue
 * ---------------------------------------------------------------------------
 * `listArticles` pagine, traduit, joint les images et les marques : tout ce
 * qu'il faut pour composer une grille, et rien de ce qu'il faut ici. Le plan
 * de site n'a besoin que d'une adresse et d'une date, pour la totalité du
 * catalogue d'un coup.
 *
 * ---------------------------------------------------------------------------
 * Les pièces VENDUES y figurent, et c'est délibéré
 * ---------------------------------------------------------------------------
 * `visibleArticleWhere` les inclut : leur fiche répond 200, par une décision
 * écrite — renvoyer 404 sur une pièce vendue détruirait le référencement
 * acquis, souvent le seul trafic qu'une pièce unique aura jamais eu. Les
 * retirer du plan de site reviendrait à demander aux moteurs d'oublier des
 * pages qu'on a choisi de garder.
 */

export interface SitemapResource {
  /** Chemin SANS préfixe de langue, ex. `/a/veste-en-laine`. */
  path: string
  lastModified: Date
}

/**
 * Plafond de sécurité.
 *
 * Un plan de site vaut 50 000 URL et 50 Mo au maximum ; au-delà, il n'est pas
 * « tronqué », il est REFUSÉ en entier. Le nôtre porte une entrée par
 * ressource, avec les huit langues en alternatives — c'est la forme
 * recommandée, et celle qui divise par huit le nombre d'entrées.
 *
 * La marge sous le plafond laisse la place aux catégories, aux marques et aux
 * pages fixes. Si elle est atteinte un jour, la suite est de découper le plan
 * par langue ou par tranche, pas de relever ce nombre.
 */
export const SITEMAP_MAX_ARTICLES = 45_000

/** Les fiches article consultables, les plus récemment modifiées d'abord. */
export async function listSitemapArticles(): Promise<SitemapResource[]> {
  const rows = await prisma.article.findMany({
    where: visibleArticleWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: SITEMAP_MAX_ARTICLES,
  })

  return rows.map((row) => ({
    path: `/a/${row.slug}`,
    lastModified: row.updatedAt,
  }))
}

/**
 * Les chemins de catégorie qui mènent à des pièces.
 *
 * ---------------------------------------------------------------------------
 * Les parents comptent, parce que la requête est RÉCURSIVE
 * ---------------------------------------------------------------------------
 * `/c/femme` n'est pas une page vide : le filtrage par catégorie descend tout
 * le sous-arbre. Une catégorie mère dont une seule feuille est fournie est
 * donc une page pleine, et elle mérite d'être annoncée.
 *
 * Le comptage se fait ici, en mémoire, plutôt que par une requête récursive :
 * les catégories se comptent en dizaines, elles tiennent toutes dans un seul
 * aller-retour, et la remontée des effectifs vers les parents s'écrit en cinq
 * lignes lisibles.
 */
export async function listSitemapCategories(): Promise<SitemapResource[]> {
  const rows = await prisma.category.findMany({
    select: {
      id: true,
      slug: true,
      parentId: true,
      updatedAt: true,
      _count: {
        select: {
          articles: {
            where: {
              status: { in: [...LISTED_STATUSES] },
              publishedAt: { not: null, lte: new Date() },
            },
          },
        },
      },
    },
  })

  const parId = new Map(rows.map((row) => [row.id, row]))

  // Effectif du sous-arbre : chaque pièce est comptée pour sa catégorie ET
  // pour chacune de ses ancêtres.
  const effectif = new Map<string, number>()
  for (const row of rows) {
    if (row._count.articles === 0) continue

    let courant: typeof row | undefined = row
    // `vus` arrête une hiérarchie qui boucherait sur elle-même : rien ne
    // l'interdit en base, et une boucle ici gèlerait la génération du plan.
    const vus = new Set<string>()
    while (courant && !vus.has(courant.id)) {
      vus.add(courant.id)
      effectif.set(
        courant.id,
        (effectif.get(courant.id) ?? 0) + row._count.articles,
      )
      courant = courant.parentId ? parId.get(courant.parentId) : undefined
    }
  }

  const cheminDe = (id: string): string | null => {
    const segments: string[] = []
    let courant = parId.get(id)
    const vus = new Set<string>()

    while (courant && !vus.has(courant.id)) {
      vus.add(courant.id)
      segments.unshift(courant.slug)
      courant = courant.parentId ? parId.get(courant.parentId) : undefined
    }

    return segments.length > 0 ? segments.join('/') : null
  }

  const resultats: SitemapResource[] = []
  for (const row of rows) {
    if ((effectif.get(row.id) ?? 0) === 0) continue

    const chemin = cheminDe(row.id)
    if (!chemin) continue

    resultats.push({ path: `/c/${chemin}`, lastModified: row.updatedAt })
  }

  return resultats
}

/** Les marques qui ont au moins une pièce en ligne. */
export async function listSitemapBrands(): Promise<SitemapResource[]> {
  const rows = await prisma.brand.findMany({
    select: {
      slug: true,
      updatedAt: true,
      _count: {
        select: {
          articles: {
            where: {
              status: { in: [...LISTED_STATUSES] },
              publishedAt: { not: null, lte: new Date() },
            },
          },
        },
      },
    },
    orderBy: { slug: 'asc' },
  })

  return rows
    .filter((row) => row._count.articles > 0)
    .map((row) => ({ path: `/marque/${row.slug}`, lastModified: row.updatedAt }))
}
