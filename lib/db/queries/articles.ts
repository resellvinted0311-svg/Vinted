import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import {
  publicArticleCardSelect,
  publicArticleDetailSelect,
  type PublicArticleCard,
  type PublicArticleDetail,
} from '@/lib/db/selectors'
import {
  decodeCursor,
  encodeCursor,
  cursorValueFor,
  sortSpec,
  PAGE_SIZE,
  type CatalogueFilters,
  type SortKey,
} from '@/lib/domain/catalogue'

/**
 * Requêtes du catalogue public.
 *
 * Le tri, le curseur et la recherche plein texte sont exprimés en SQL brut :
 * la comparaison de n-uplets `(valeur, id)` qui rend la pagination stable
 * n'est pas exprimable avec le constructeur de requêtes de Prisma.
 *
 * Le SQL ne ramène que des identifiants ordonnés. Les données sont ensuite
 * relues par Prisma avec les sélecteurs publics : c'est ce qui garantit
 * qu'aucun champ privé ne peut fuir, même si quelqu'un ajoute demain une
 * colonne au SELECT brut.
 */

/**
 * Statuts visibles au catalogue.
 *
 * RESERVED est inclus : la réservation ne dure que 15 minutes et expire le
 * plus souvent. Masquer l'article ferait disparaître puis réapparaître des
 * pièces sans explication. Il est affiché avec une mention honnête.
 * SOLD est exclu du listing, mais sa fiche reste accessible en 200.
 */
const LISTED_STATUSES = ['AVAILABLE', 'RESERVED'] as const

interface ListInput {
  filters: CatalogueFilters
  sort: SortKey
  cursor: string | null
  locale: string
  limit?: number
}

export interface ArticleListPage {
  items: PublicArticleCard[]
  nextCursor: string | null
  /** Nombre total d'articles correspondant aux filtres, hors pagination. */
  totalCount: number
}

/** Expansion récursive : filtrer sur « Hauts » inclut ses sous-catégories. */
function categoryCte(slugs: string[]): Prisma.Sql {
  if (slugs.length === 0) return Prisma.empty

  return Prisma.sql`
    WITH RECURSIVE selected_category AS (
      SELECT id FROM "Category" WHERE slug IN (${Prisma.join(slugs)})
      UNION
      SELECT c.id FROM "Category" c
      JOIN selected_category s ON c."parentId" = s.id
    )
  `
}

/**
 * Clauses WHERE communes.
 *
 * `skipDimension` permet de calculer les compteurs d'une facette en ignorant
 * son propre filtre : sans cela, sélectionner « Levi's » afficherait 0 pour
 * toutes les autres marques et il deviendrait impossible d'en changer.
 */
function whereClauses(
  filters: CatalogueFilters,
  locale: string,
  skipDimension?: keyof CatalogueFilters,
): Prisma.Sql[] {
  // `= ANY(tableau::type)` plutôt que `IN (…)` : un seul paramètre, et la
  // conversion explicite vers le type énuméré permet à PostgreSQL de
  // continuer à utiliser les index partiels posés sur `status`.
  const clauses: Prisma.Sql[] = [
    Prisma.sql`a.status = ANY(${[...LISTED_STATUSES]}::"ArticleStatus"[])`,
    Prisma.sql`a."publishedAt" IS NOT NULL`,
    Prisma.sql`a."publishedAt" <= now()`,
  ]

  if (filters.categorySlugs.length > 0 && skipDimension !== 'categorySlugs') {
    clauses.push(
      Prisma.sql`a."categoryId" IN (SELECT id FROM selected_category)`,
    )
  }

  if (filters.brandSlugs.length > 0 && skipDimension !== 'brandSlugs') {
    clauses.push(Prisma.sql`b.slug = ANY(${filters.brandSlugs}::text[])`)
  }

  if (filters.sizes.length > 0 && skipDimension !== 'sizes') {
    clauses.push(
      Prisma.sql`a."sizeNormalized" = ANY(${filters.sizes}::text[])`,
    )
  }

  if (filters.conditions.length > 0 && skipDimension !== 'conditions') {
    clauses.push(
      Prisma.sql`a.condition = ANY(${filters.conditions}::"ArticleCondition"[])`,
    )
  }

  if (filters.colors.length > 0 && skipDimension !== 'colors') {
    clauses.push(Prisma.sql`a.color = ANY(${filters.colors}::text[])`)
  }

  if (filters.materials.length > 0 && skipDimension !== 'materials') {
    clauses.push(Prisma.sql`a.material = ANY(${filters.materials}::text[])`)
  }

  if (filters.minPriceCents !== null) {
    clauses.push(Prisma.sql`a."priceCents" >= ${filters.minPriceCents}`)
  }
  if (filters.maxPriceCents !== null) {
    clauses.push(Prisma.sql`a."priceCents" <= ${filters.maxPriceCents}`)
  }

  if (filters.query) {
    // Deux voies complémentaires : le vecteur plein texte (racinisé, sans
    // accent) attrape les formes fléchies, le trigramme rattrape les fautes
    // de frappe que le dictionnaire ne reconnaît pas.
    clauses.push(Prisma.sql`(
      t."searchVector" @@ websearch_to_tsquery(nd_regconfig(${locale}), nd_unaccent(${filters.query}))
      OR nd_unaccent(lower(t.title)) LIKE '%' || nd_unaccent(lower(${filters.query})) || '%'
    )`)
  }

  return clauses
}

function andAll(clauses: Prisma.Sql[]): Prisma.Sql {
  return clauses.reduce(
    (acc, clause, index) =>
      index === 0 ? clause : Prisma.sql`${acc} AND ${clause}`,
    Prisma.empty,
  )
}

/** Expression de tri, avec les NULL toujours en fin de liste. */
function sortExpression(sort: SortKey): Prisma.Sql {
  const spec = sortSpec(sort)

  if (spec.column === 'priceCents') return Prisma.sql`a."priceCents"`
  if (spec.column === 'publishedAt') {
    return Prisma.sql`COALESCE((EXTRACT(EPOCH FROM a."publishedAt") * 1000)::bigint, 0)`
  }
  return Prisma.sql`COALESCE((EXTRACT(EPOCH FROM a."lastPriceDropAt") * 1000)::bigint, 0)`
}

export async function listArticles({
  filters,
  sort,
  cursor,
  locale,
  limit = PAGE_SIZE,
}: ListInput): Promise<ArticleListPage> {
  const spec = sortSpec(sort)
  const orderDirection = Prisma.raw(spec.direction === 'asc' ? 'ASC' : 'DESC')
  const cursorOperator = Prisma.raw(spec.direction === 'asc' ? '>' : '<')

  const decoded = decodeCursor(cursor)
  const clauses = whereClauses(filters, locale)

  if (decoded) {
    // Comparaison de n-uplets : l'identifiant départage les ex æquo. Sans
    // lui, deux articles au même prix peuvent se masquer mutuellement entre
    // deux pages.
    clauses.push(
      Prisma.sql`(${sortExpression(sort)}, a.id) ${cursorOperator} (${decoded.value}::bigint, ${decoded.id})`,
    )
  }

  const cte = categoryCte(filters.categorySlugs)
  const where = andAll(clauses)

  // On demande un élément de plus que la page : sa présence indique qu'il
  // existe une suite, sans avoir à compter quoi que ce soit.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    ${cte}
    SELECT a.id
    FROM "Article" a
    JOIN "ArticleTranslation" t
      ON t."articleId" = a.id AND t.locale = ${locale}
    LEFT JOIN "Brand" b ON b.id = a."brandId"
    WHERE ${where}
    ORDER BY ${sortExpression(sort)} ${orderDirection}, a.id ${orderDirection}
    LIMIT ${limit + 1}
  `

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const ids = pageRows.map((row) => row.id)

  const countClauses = whereClauses(filters, locale)
  const [totalRows, articles] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`
      ${categoryCte(filters.categorySlugs)}
      SELECT count(*)::bigint AS count
      FROM "Article" a
      JOIN "ArticleTranslation" t
        ON t."articleId" = a.id AND t.locale = ${locale}
      LEFT JOIN "Brand" b ON b.id = a."brandId"
      WHERE ${andAll(countClauses)}
    `,
    ids.length === 0
      ? Promise.resolve([] as PublicArticleCard[])
      : prisma.article.findMany({
          where: { id: { in: ids } },
          select: publicArticleCardSelect,
        }),
  ])

  // findMany ne préserve pas l'ordre du IN : on le rétablit depuis le SQL.
  const byId = new Map(articles.map((article) => [article.id, article]))
  const items = ids
    .map((id) => byId.get(id))
    .filter((article): article is PublicArticleCard => article !== undefined)

  const last = items.at(-1)
  const nextCursor =
    hasMore && last ? encodeCursor(cursorValueFor(sort, last)) : null

  return {
    items,
    nextCursor,
    totalCount: Number(totalRows[0]?.count ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Facettes
// ---------------------------------------------------------------------------

export interface FacetEntry {
  value: string
  label: string
  count: number
}

export interface Facets {
  categories: FacetEntry[]
  brands: FacetEntry[]
  sizes: FacetEntry[]
  conditions: FacetEntry[]
  colors: FacetEntry[]
  materials: FacetEntry[]
  priceRange: { minCents: number; maxCents: number } | null
}

async function facetCount(
  filters: CatalogueFilters,
  locale: string,
  dimension: keyof CatalogueFilters,
  valueExpression: Prisma.Sql,
  labelExpression: Prisma.Sql,
): Promise<FacetEntry[]> {
  const clauses = whereClauses(filters, locale, dimension)
  clauses.push(Prisma.sql`${valueExpression} IS NOT NULL`)

  const rows = await prisma.$queryRaw<
    { value: string; label: string; count: bigint }[]
  >`
    ${categoryCte(filters.categorySlugs)}
    SELECT ${valueExpression} AS value,
           ${labelExpression} AS label,
           count(*)::bigint AS count
    FROM "Article" a
    JOIN "ArticleTranslation" t
      ON t."articleId" = a.id AND t.locale = ${locale}
    LEFT JOIN "Brand" b ON b.id = a."brandId"
    JOIN "Category" c ON c.id = a."categoryId"
    LEFT JOIN "CategoryTranslation" ct
      ON ct."categoryId" = c.id AND ct.locale = ${locale}
    WHERE ${andAll(clauses)}
    GROUP BY 1, 2
    ORDER BY count DESC, 1 ASC
    LIMIT 60
  `

  return rows.map((row) => ({
    value: row.value,
    label: row.label ?? row.value,
    count: Number(row.count),
  }))
}

/**
 * Compteurs de facettes.
 *
 * Chaque dimension est comptée en ignorant son propre filtre, ce qui permet
 * de basculer d'une marque à l'autre sans repasser par une remise à zéro.
 * Les six requêtes partent en parallèle.
 */
export async function getFacets(
  filters: CatalogueFilters,
  locale: string,
): Promise<Facets> {
  const [categories, brands, sizes, conditions, colors, materials, price] =
    await Promise.all([
      facetCount(filters, locale, 'categorySlugs', Prisma.sql`c.slug`, Prisma.sql`ct.name`),
      facetCount(filters, locale, 'brandSlugs', Prisma.sql`b.slug`, Prisma.sql`b.name`),
      facetCount(filters, locale, 'sizes', Prisma.sql`a."sizeNormalized"`, Prisma.sql`a."sizeLabel"`),
      facetCount(filters, locale, 'conditions', Prisma.sql`a.condition::text`, Prisma.sql`a.condition::text`),
      facetCount(filters, locale, 'colors', Prisma.sql`a.color`, Prisma.sql`a.color`),
      facetCount(filters, locale, 'materials', Prisma.sql`a.material`, Prisma.sql`a.material`),
      prisma.$queryRaw<{ min: number | null; max: number | null }[]>`
        ${categoryCte(filters.categorySlugs)}
        SELECT min(a."priceCents")::int AS min, max(a."priceCents")::int AS max
        FROM "Article" a
        JOIN "ArticleTranslation" t
          ON t."articleId" = a.id AND t.locale = ${locale}
        LEFT JOIN "Brand" b ON b.id = a."brandId"
        WHERE ${andAll(whereClauses(filters, locale))}
      `,
    ])

  const bounds = price[0]

  return {
    categories,
    brands,
    sizes,
    conditions,
    colors,
    materials,
    priceRange:
      bounds?.min != null && bounds.max != null
        ? { minCents: bounds.min, maxCents: bounds.max }
        : null,
  }
}

// ---------------------------------------------------------------------------
// Fiche article
// ---------------------------------------------------------------------------

/**
 * Un article vendu reste consultable.
 *
 * Renvoyer 404 sur une pièce vendue détruit le référencement acquis : la page
 * reste en 200, marquée SoldOut, avec des articles similaires disponibles.
 * Seuls les brouillons et les archives sont réellement introuvables.
 */
export async function getArticleBySlug(
  slug: string,
  locale: string,
): Promise<PublicArticleDetail | null> {
  const article = await prisma.article.findFirst({
    where: {
      slug,
      status: { in: ['AVAILABLE', 'RESERVED', 'SOLD'] },
      publishedAt: { not: null, lte: new Date() },
    },
    select: publicArticleDetailSelect,
  })

  if (!article) return null

  // La traduction demandée peut manquer sur un article tout juste créé :
  // on retombe sur le français plutôt que d'afficher une fiche vide.
  const hasLocale = article.translations.some((t) => t.locale === locale)
  if (!hasLocale && article.translations.length === 0) return null

  return article
}

export async function getSimilarArticles(
  {
    excludeId,
    categoryId,
    brandId,
    sizeNormalized,
  }: {
    excludeId: string
    categoryId: string
    brandId: string | null
    sizeNormalized: string | null
  },
  locale: string,
  take = 4,
): Promise<PublicArticleCard[]> {
  // Priorité aux pièces de même catégorie ET même taille : c'est le premier
  // critère de substitution pour quelqu'un qui vient de rater un article.
  // Les paramètres sont typés explicitement, sinon PostgreSQL ne peut pas
  // inférer le type d'un paramètre confronté à IS NOT DISTINCT FROM.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id
    FROM "Article" a
    JOIN "ArticleTranslation" t
      ON t."articleId" = a.id AND t.locale = ${locale}
    WHERE a.status = 'AVAILABLE'
      AND a."publishedAt" IS NOT NULL
      AND a."publishedAt" <= now()
      AND a.id <> ${excludeId}
    ORDER BY
      (a."categoryId" = ${categoryId}::text) DESC,
      (a."sizeNormalized" IS NOT DISTINCT FROM ${sizeNormalized}::text) DESC,
      (a."brandId" IS NOT DISTINCT FROM ${brandId}::text) DESC,
      a."publishedAt" DESC
    LIMIT ${take}
  `

  const ids = rows.map((row) => row.id)
  if (ids.length === 0) return []

  const articles = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: publicArticleCardSelect,
  })

  const byId = new Map(articles.map((entry) => [entry.id, entry]))
  return ids
    .map((id) => byId.get(id))
    .filter((entry): entry is PublicArticleCard => entry !== undefined)
}

/**
 * Nombre de pièces actuellement au registre.
 *
 * Sert le bandeau d'accueil. C'est une taille d'inventaire, pas un compteur
 * d'urgence : elle décrit ce qui existe, elle ne prétend pas qu'il faut se
 * dépêcher. Le brief interdit les seconds, pas les premières.
 */
export async function countListedArticles(): Promise<number> {
  return prisma.article.count({
    where: { status: { in: [...LISTED_STATUSES] } },
  })
}

/** Derniers arrivages, pour l'accueil. */
export async function getLatestArticles(
  locale: string,
  take = 8,
): Promise<PublicArticleCard[]> {
  return listArticles({
    filters: {
      categorySlugs: [],
      brandSlugs: [],
      sizes: [],
      conditions: [],
      colors: [],
      materials: [],
      minPriceCents: null,
      maxPriceCents: null,
      query: null,
    },
    sort: 'nouveautes',
    cursor: null,
    locale,
    limit: take,
  }).then((page) => page.items)
}
