import 'server-only'

import { prisma } from '@/lib/db/client'

/**
 * Autocomplétion.
 *
 * Trois sources interrogées en parallèle : les marques, les catégories et les
 * titres d'articles. Les marques et catégories sont volontairement traitées à
 * part du vecteur plein texte des articles — un renommage de marque n'exige
 * ainsi aucune réindexation du catalogue.
 */

export interface Suggestion {
  type: 'article' | 'brand' | 'category'
  label: string
  href: string
  /** Contexte affiché en second, plus discret. */
  detail?: string
}

export async function suggest(
  query: string,
  locale: string,
  limit = 8,
): Promise<Suggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const [brands, categories, articles] = await Promise.all([
    prisma.$queryRaw<{ slug: string; name: string }[]>`
      SELECT slug, name
      FROM "Brand"
      WHERE nd_unaccent(lower(name)) LIKE '%' || nd_unaccent(lower(${trimmed})) || '%'
      ORDER BY similarity(nd_unaccent(lower(name)), nd_unaccent(lower(${trimmed}))) DESC
      LIMIT 3
    `,
    // Le chemin complet est reconstruit récursivement : la route /c/[...slug]
    // vérifie que le chemin correspond à la hiérarchie réelle, un lien vers
    // `/c/chemises` seul serait donc rejeté en 404.
    prisma.$queryRaw<{ slug: string; name: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id, slug::text AS path
        FROM "Category"
        WHERE "parentId" IS NULL
        UNION ALL
        SELECT c.id, t.path || '/' || c.slug
        FROM "Category" c
        JOIN tree t ON c."parentId" = t.id
      )
      SELECT tree.path AS slug, ct.name
      FROM tree
      JOIN "CategoryTranslation" ct
        ON ct."categoryId" = tree.id AND ct.locale = ${locale}
      WHERE nd_unaccent(lower(ct.name)) LIKE '%' || nd_unaccent(lower(${trimmed})) || '%'
      ORDER BY similarity(nd_unaccent(lower(ct.name)), nd_unaccent(lower(${trimmed}))) DESC
      LIMIT 3
    `,
    prisma.$queryRaw<{ slug: string; title: string; brand: string | null }[]>`
      SELECT a.slug, t.title, b.name AS brand
      FROM "Article" a
      JOIN "ArticleTranslation" t
        ON t."articleId" = a.id AND t.locale = ${locale}
      LEFT JOIN "Brand" b ON b.id = a."brandId"
      WHERE a.status = ANY(ARRAY['AVAILABLE','RESERVED']::"ArticleStatus"[])
        AND a."publishedAt" IS NOT NULL
        AND a."publishedAt" <= now()
        AND (
          t."searchVector" @@ websearch_to_tsquery(nd_regconfig(${locale}), nd_unaccent(${trimmed}))
          OR nd_unaccent(lower(t.title)) LIKE '%' || nd_unaccent(lower(${trimmed})) || '%'
        )
      ORDER BY a."publishedAt" DESC
      LIMIT ${limit}
    `,
  ])

  // Marques et catégories d'abord : ce sont des raccourcis vers une page
  // entière, plus utiles qu'un article isolé.
  return [
    ...brands.map(
      (brand): Suggestion => ({
        type: 'brand',
        label: brand.name,
        href: `/marque/${brand.slug}`,
      }),
    ),
    ...categories.map(
      (category): Suggestion => ({
        type: 'category',
        label: category.name,
        href: `/c/${category.slug}`,
      }),
    ),
    ...articles.map(
      (article): Suggestion => ({
        type: 'article',
        label: article.title,
        href: `/a/${article.slug}`,
        ...(article.brand ? { detail: article.brand } : {}),
      }),
    ),
  ].slice(0, limit)
}
