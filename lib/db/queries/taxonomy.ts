import 'server-only'

import { prisma } from '@/lib/db/client'

/**
 * Catégories et marques.
 *
 * Le libellé est résolu dans la langue demandée, avec repli sur le français :
 * une traduction manquante ne doit jamais produire une entrée de menu vide.
 */

export interface CategoryNode {
  id: string
  slug: string
  name: string
  position: number
  children: CategoryNode[]
}

function nameFor(
  translations: { locale: string; name: string }[],
  locale: string,
  fallback: string,
): string {
  return (
    translations.find((t) => t.locale === locale)?.name ??
    translations.find((t) => t.locale === 'fr')?.name ??
    fallback
  )
}

export async function getCategoryTree(locale: string): Promise<CategoryNode[]> {
  const rows = await prisma.category.findMany({
    select: {
      id: true,
      slug: true,
      parentId: true,
      position: true,
      translations: { select: { locale: true, name: true } },
    },
    orderBy: { position: 'asc' },
  })

  const nodes = new Map<string, CategoryNode>()
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: nameFor(row.translations, locale, row.slug),
      position: row.position,
      children: [],
    })
  }

  const roots: CategoryNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)
    if (!node) continue

    if (row.parentId) {
      nodes.get(row.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export interface CategoryDetail {
  id: string
  slug: string
  name: string
  seoTitle: string | null
  seoDescription: string | null
  editorialBody: string | null
  /** Fil d'Ariane, de la racine jusqu'à la catégorie courante. */
  ancestors: { slug: string; name: string }[]
}

/**
 * Résout une catégorie depuis un chemin `/c/hauts/chemises`.
 *
 * Seul le dernier segment identifie la catégorie ; les précédents servent au
 * fil d'Ariane et sont vérifiés pour éviter qu'un chemin incohérent réponde
 * en 200 (contenu dupliqué).
 */
export async function getCategoryByPath(
  segments: string[],
  locale: string,
): Promise<CategoryDetail | null> {
  const slug = segments.at(-1)
  if (!slug) return null

  const category = await prisma.category.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      parentId: true,
      translations: {
        select: {
          locale: true,
          name: true,
          seoTitle: true,
          seoDescription: true,
          editorialBody: true,
        },
      },
    },
  })
  if (!category) return null

  const ancestors: { slug: string; name: string }[] = []
  let parentId = category.parentId

  while (parentId) {
    const parent = await prisma.category.findUnique({
      where: { id: parentId },
      select: {
        slug: true,
        parentId: true,
        translations: { select: { locale: true, name: true } },
      },
    })
    if (!parent) break

    ancestors.unshift({
      slug: parent.slug,
      name: nameFor(parent.translations, locale, parent.slug),
    })
    parentId = parent.parentId
  }

  // Le chemin annoncé doit correspondre à la hiérarchie réelle.
  const expected = [...ancestors.map((a) => a.slug), category.slug]
  if (segments.join('/') !== expected.join('/')) return null

  const translation =
    category.translations.find((t) => t.locale === locale) ??
    category.translations.find((t) => t.locale === 'fr')

  return {
    id: category.id,
    slug: category.slug,
    name: translation?.name ?? category.slug,
    seoTitle: translation?.seoTitle ?? null,
    seoDescription: translation?.seoDescription ?? null,
    editorialBody: translation?.editorialBody ?? null,
    ancestors,
  }
}

/** Chemin complet d'une catégorie, pour construire ses liens. */
export async function getCategoryPath(slug: string): Promise<string[]> {
  const path: string[] = []
  let current: { slug: string; parentId: string | null } | null =
    await prisma.category.findUnique({
      where: { slug },
      select: { slug: true, parentId: true },
    })

  while (current) {
    path.unshift(current.slug)
    if (!current.parentId) break
    current = await prisma.category.findUnique({
      where: { id: current.parentId },
      select: { slug: true, parentId: true },
    })
  }

  return path
}

export interface BrandSummary {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  isLuxury: boolean
  articleCount: number
}

/** Marques ayant au moins un article en ligne. */
export async function listBrandsWithCounts(): Promise<BrandSummary[]> {
  const brands = await prisma.brand.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      isLuxury: true,
      _count: {
        select: {
          articles: {
            where: {
              status: { in: ['AVAILABLE', 'RESERVED'] },
              publishedAt: { not: null, lte: new Date() },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return brands
    .map((brand) => ({
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      logoUrl: brand.logoUrl,
      isLuxury: brand.isLuxury,
      articleCount: brand._count.articles,
    }))
    .filter((brand) => brand.articleCount > 0)
}

export interface CategoryEntry {
  id: string
  /** Chemin complet, prêt à composer une URL `/c/…`. */
  path: string
  name: string
  articleCount: number
}

/**
 * Catégories terminales et leur nombre de pièces en ligne.
 *
 * Seules les feuilles sont retenues — une pièce est toujours rangée dans une
 * feuille, un parent n'apporterait qu'un doublon.
 *
 * SANS APPELANT pour l'instant, et c'est assumé : l'accueil les présentait en
 * index typographique, cette section a été retirée. La fonction reste parce
 * que la place des catégories sur l'accueil est en cours d'arbitrage — la
 * supprimer pour la réécrire à l'identique dans quelques jours serait du
 * mouvement, pas du ménage. Si l'arbitrage conclut autrement, elle part.
 */
export async function listCategoriesWithCounts(
  locale: string,
): Promise<CategoryEntry[]> {
  const rows = await prisma.category.findMany({
    select: {
      id: true,
      slug: true,
      parentId: true,
      position: true,
      translations: { select: { locale: true, name: true } },
      parent: { select: { slug: true } },
      _count: {
        select: {
          articles: {
            where: {
              status: { in: ['AVAILABLE', 'RESERVED'] },
              publishedAt: { not: null, lte: new Date() },
            },
          },
        },
      },
    },
    orderBy: { position: 'asc' },
  })

  return rows
    .filter((row) => row._count.articles > 0)
    .map((row) => ({
      id: row.id,
      path: row.parent ? `${row.parent.slug}/${row.slug}` : row.slug,
      name: nameFor(row.translations, locale, row.slug),
      articleCount: row._count.articles,
    }))
    // Les plus fournies d'abord : l'index sert à entrer dans le catalogue,
    // pas à réciter l'arborescence.
    .sort((a, b) => b.articleCount - a.articleCount)
}

export async function getBrandBySlug(slug: string) {
  return prisma.brand.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, logoUrl: true, isLuxury: true },
  })
}
