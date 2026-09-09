import 'server-only'

import { cache } from 'react'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import {
  publicArticleCardSelectFor,
  publicArticleDetailSelect,
  type PublicArticleCard,
  type PublicArticleDetail,
} from '@/lib/db/selectors'
import {
  LISTED_STATUSES,
  listedArticleWhere,
  visibleArticleWhere,
} from '@/lib/db/visibility'
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

// Les statuts visibles vivent dans `lib/db/visibility.ts` : la même règle sert
// au catalogue, à la fiche, aux favoris et au compteur d'accueil.

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
    clauses.push(Prisma.sql`a."sizeNormalized" = ANY(${filters.sizes}::text[])`)
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

  // Une pièce sans univers n'appartient à aucun des deux : `= ANY` sur NULL
  // ne renvoie pas vrai, et c'est exactement ce qu'on veut. Elle reste
  // trouvable au catalogue, elle n'entre simplement dans aucune vitrine.
  if (filters.audiences.length > 0 && skipDimension !== 'audiences') {
    clauses.push(Prisma.sql`a.audience = ANY(${filters.audiences}::text[])`)
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

  /*
    Le TOTAL voyage avec la page, quand il peut.

    Il faisait l'objet d'une requête à lui : le même CTE récursif, la même
    jointure de traductions, la même clause WHERE, rejoués en entier pour
    obtenir un seul nombre. Deuxième aller-retour à chaque affichage de
    catalogue, de rayon, de marque et de vitrine — c'est-à-dire sur presque
    toutes les pages de la boutique.

    `count(*) OVER ()` le donne dans la MÊME requête : la fenêtre est calculée
    sur l'ensemble filtré avant que `LIMIT` ne s'applique, donc le nombre est
    le total, pas la taille de la page. Le travail en base est le même ; c'est
    le trajet réseau qui disparaît.

    UNIQUEMENT en l'absence de curseur, et ce n'est pas une optimisation
    partielle par paresse : avec un curseur, la clause `(tri, id) > (…)` fait
    partie du WHERE, la fenêtre compterait donc ce qui RESTE et non le total.
    Le comptage séparé est conservé pour ce cas — le plus rare, puisqu'il
    n'arrive qu'au « voir la suite » et sur une adresse partagée. La valeur
    renvoyée garde ainsi exactement le même sens dans les deux cas.
  */
  const totalDansLaPage = decoded === null

  // On demande un élément de plus que la page : sa présence indique qu'il
  // existe une suite, sans avoir à compter quoi que ce soit.
  const rows = await prisma.$queryRaw<{ id: string; total: bigint | null }[]>`
    ${cte}
    SELECT
      a.id,
      ${totalDansLaPage ? Prisma.sql`count(*) OVER ()` : Prisma.sql`NULL::bigint`} AS total
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

  const compterAPart = !totalDansLaPage

  const [totalRows, articles] = await Promise.all([
    compterAPart
      ? prisma.$queryRaw<{ count: bigint }[]>`
          ${categoryCte(filters.categorySlugs)}
          SELECT count(*)::bigint AS count
          FROM "Article" a
          JOIN "ArticleTranslation" t
            ON t."articleId" = a.id AND t.locale = ${locale}
          LEFT JOIN "Brand" b ON b.id = a."brandId"
          WHERE ${andAll(whereClauses(filters, locale))}
        `
      : Promise.resolve([] as { count: bigint }[]),
    ids.length === 0
      ? Promise.resolve([] as PublicArticleCard[])
      : prisma.article.findMany({
          where: { id: { in: ids } },
          select: publicArticleCardSelectFor(locale),
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
    totalCount: compterAPart
      ? Number(totalRows[0]?.count ?? 0)
      : Number(rows[0]?.total ?? 0),
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
  audiences: FacetEntry[]
  priceRange: { minCents: number; maxCents: number } | null
}

/** Les tables et jointures communes à toutes les branches de facette. */
const FACET_SOURCE = (locale: string): Prisma.Sql => Prisma.sql`
  FROM "Article" a
  JOIN "ArticleTranslation" t
    ON t."articleId" = a.id AND t.locale = ${locale}
  LEFT JOIN "Brand" b ON b.id = a."brandId"
  JOIN "Category" c ON c.id = a."categoryId"
  LEFT JOIN "CategoryTranslation" ct
    ON ct."categoryId" = c.id AND ct.locale = ${locale}
`

/**
 * Une branche de facette : les compteurs d'UNE dimension.
 *
 * Elle est parenthésée et porte son propre `ORDER BY` et son propre `LIMIT` :
 * c'est ce qui permet de la coudre aux sept autres par `UNION ALL` sans que
 * le tri de l'une déborde sur les autres.
 *
 * `skipDimension` reste le cœur de la logique : on ignore le filtre de la
 * dimension qu'on compte, sans quoi sélectionner « Levi's » afficherait 0
 * partout ailleurs et il deviendrait impossible d'en changer.
 */
function facetBranch(
  filters: CatalogueFilters,
  locale: string,
  dimension: keyof CatalogueFilters,
  nom: string,
  valueExpression: Prisma.Sql,
  labelExpression: Prisma.Sql,
): Prisma.Sql {
  const clauses = whereClauses(filters, locale, dimension)
  clauses.push(Prisma.sql`${valueExpression} IS NOT NULL`)

  // Les types des colonnes doivent coïncider d'une branche à l'autre, sinon
  // PostgreSQL refuse l'union. D'où les conversions explicites, y compris sur
  // les colonnes qu'une branche donnée n'utilise pas.
  return Prisma.sql`(
    SELECT ${nom}::text AS dim,
           (${valueExpression})::text AS value,
           (${labelExpression})::text AS label,
           count(*)::bigint AS count,
           NULL::int AS min_cents,
           NULL::int AS max_cents
    ${FACET_SOURCE(locale)}
    WHERE ${andAll(clauses)}
    GROUP BY (${valueExpression})::text, (${labelExpression})::text
    ORDER BY count(*) DESC, (${valueExpression})::text ASC
    LIMIT 60
  )`
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
  /**
   * Le client à interroger. Sert à COMPTER les allers-retours.
   *
   * Le gain de cette fonction tient dans son nombre de requêtes, pas dans son
   * résultat. Vérifier l'égalité des résultats sans vérifier le nombre
   * d'appels laisserait une réécriture future revenir à neuf requêtes en
   * gardant tous les tests au vert — le compteur serait alors le seul témoin,
   * et il n'existerait pas.
   *
   * Le paramètre est donc là pour qu'un test puisse passer un client
   * instrumenté. En production, la valeur par défaut est celle du singleton et
   * personne n'a à s'en soucier.
   */
  client: Pick<typeof prisma, '$queryRaw'> = prisma,
): Promise<Facets> {
  /**
   * UNE requête, et non plus neuf.
   *
   * -------------------------------------------------------------------------
   * Pourquoi le `Promise.all` d'avant ne parallélisait rien
   * -------------------------------------------------------------------------
   * Les sept compteurs et les bornes de prix partaient dans un `Promise.all`,
   * ce qui donne l'apparence du parallélisme. En production il n'y en avait
   * aucun : la connexion applicative porte `connection_limit=1` — le réglage
   * juste derrière un pooler — et les neuf requêtes faisaient donc la queue
   * sur une seule connexion, l'une après l'autre.
   *
   * Chacune embarquait en outre la MÊME sous-requête récursive de catégories.
   * Mesuré sur un rendu de page de rayon : dix-neuf requêtes SQL, dont dix
   * fois cette récursion, à paramètres identiques.
   *
   * Neuf allers-retours coûtent neuf fois la distance à la base. C'est
   * indolore en local — moins d'une milliseconde pièce — et c'est ce qui
   * faisait les secondes d'attente depuis une région éloignée.
   *
   * -------------------------------------------------------------------------
   * Ce que l'union change, et ce qu'elle ne change pas
   * -------------------------------------------------------------------------
   * Les branches sont exactement les requêtes d'avant, parenthésées et
   * cousues par `UNION ALL` : mêmes clauses, même `skipDimension`, mêmes
   * tris, mêmes limites. Seul le nombre d'allers-retours change.
   *
   * L'équivalence n'est pas affirmée, elle est VÉRIFIÉE : la sortie de
   * l'ancienne version a été capturée sur neuf combinaisons de filtres, et
   * `tests/integration/facettes.test.ts` compare la nouvelle à cette
   * empreinte.
   */
  const branches = [
    facetBranch(
      filters,
      locale,
      'categorySlugs',
      'categories',
      Prisma.sql`c.slug`,
      Prisma.sql`ct.name`,
    ),
    facetBranch(
      filters,
      locale,
      'brandSlugs',
      'brands',
      Prisma.sql`b.slug`,
      Prisma.sql`b.name`,
    ),
    facetBranch(
      filters,
      locale,
      'sizes',
      'sizes',
      Prisma.sql`a."sizeNormalized"`,
      Prisma.sql`a."sizeLabel"`,
    ),
    facetBranch(
      filters,
      locale,
      'conditions',
      'conditions',
      Prisma.sql`a.condition::text`,
      Prisma.sql`a.condition::text`,
    ),
    facetBranch(
      filters,
      locale,
      'colors',
      'colors',
      Prisma.sql`a.color`,
      Prisma.sql`a.color`,
    ),
    facetBranch(
      filters,
      locale,
      'materials',
      'materials',
      Prisma.sql`a.material`,
      Prisma.sql`a.material`,
    ),
    facetBranch(
      filters,
      locale,
      'audiences',
      'audiences',
      Prisma.sql`a.audience`,
      Prisma.sql`a.audience`,
    ),
    // Les bornes de prix : une seule ligne, sans compteur, et SANS
    // `skipDimension` — l'amplitude annoncée sous le curseur doit être celle
    // de la sélection courante, pas d'une sélection qu'on n'a pas faite.
    Prisma.sql`(
      SELECT 'price'::text AS dim,
             NULL::text AS value,
             NULL::text AS label,
             NULL::bigint AS count,
             min(a."priceCents")::int AS min_cents,
             max(a."priceCents")::int AS max_cents
      ${FACET_SOURCE(locale)}
      WHERE ${andAll(whereClauses(filters, locale))}
    )`,
  ]

  const rows = await client.$queryRaw<
    {
      dim: string
      value: string | null
      label: string | null
      count: bigint | null
      min_cents: number | null
      max_cents: number | null
    }[]
  >`
    ${categoryCte(filters.categorySlugs)}
    ${Prisma.join(branches, ' UNION ALL ')}
  `

  const parDimension = (nom: string): FacetEntry[] =>
    rows
      .filter((row) => row.dim === nom && row.value !== null)
      .map((row) => ({
        value: row.value as string,
        label: row.label ?? (row.value as string),
        count: Number(row.count),
      }))

  const bornes = rows.find((row) => row.dim === 'price')

  return {
    categories: parDimension('categories'),
    brands: parDimension('brands'),
    sizes: parDimension('sizes'),
    conditions: parDimension('conditions'),
    colors: parDimension('colors'),
    materials: parDimension('materials'),
    audiences: parDimension('audiences'),
    priceRange:
      bornes?.min_cents != null && bornes.max_cents != null
        ? { minCents: bornes.min_cents, maxCents: bornes.max_cents }
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
/**
 * Mutualisée sur la durée d'un rendu par `cache` de React.
 *
 * Next appelle `generateMetadata` PUIS le composant de page, et les deux ont
 * besoin de la même pièce. Sans cette enveloppe, la lecture part deux fois :
 * mesuré sur une fiche article, vingt-deux requêtes SQL dont la moitié
 * exactement en double — la pièce, ses traductions, ses images, ses mesures,
 * sa marque et sa catégorie, lues une fois pour le titre de l'onglet et une
 * fois pour la page.
 *
 * C'est un doublon que rien ne signale : les deux lectures rendent la même
 * chose, la page est juste, et elle coûte le double.
 */
export const getArticleBySlug = cache(async function getArticleBySlug(
  slug: string,
  locale: string,
): Promise<PublicArticleDetail | null> {
  const article = await prisma.article.findFirst({
    where: { slug, ...visibleArticleWhere() },
    select: publicArticleDetailSelect,
  })

  if (!article) return null

  // La traduction demandée peut manquer sur un article tout juste créé :
  // on retombe sur le français plutôt que d'afficher une fiche vide.
  const hasLocale = article.translations.some((t) => t.locale === locale)
  if (!hasLocale && article.translations.length === 0) return null

  return article
})

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
    select: publicArticleCardSelectFor(locale),
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
  // La publication compte autant que le statut : sans elle, le bandeau
  // annoncerait des pièces qu'aucune visiteuse ne peut ouvrir.
  return prisma.article.count({ where: listedArticleWhere() })
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
      audiences: [],
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

/**
 * Une photographie par catégorie, pour illustrer les cartes d'entrée.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la pièce la plus récente, et pas un visuel choisi
 * ---------------------------------------------------------------------------
 * Une image choisie par catégorie supposerait une colonne sur `Category` et un
 * écran pour la remplir. Or il n'existe AUCUN écran d'administration des
 * catégories : l'arbre ne se modifie que par le semis. La colonne serait donc
 * ajoutée, jamais remplie, et les cartes resteraient vides pour toujours.
 *
 * La dernière pièce entrée dans la catégorie est un choix qui se tient mieux
 * qu'un pis-aller : elle montre ce que la boutique a VRAIMENT, elle change
 * toute seule au rythme de la chine, et elle ne demande aucun travail. Le jour
 * où un visuel choisi devient souhaitable, il se posera par-dessus.
 *
 * ---------------------------------------------------------------------------
 * `DISTINCT ON` plutôt qu'une requête par catégorie
 * ---------------------------------------------------------------------------
 * Douze catégories, ce serait douze allers-retours pour douze images. La
 * clause propre à PostgreSQL retient une ligne par catégorie en un seul
 * passage — celle qui vient en tête de l'ordre demandé, donc la plus
 * récemment publiée.
 */
export async function getCategoryCovers(
  audiences: readonly string[],
): Promise<Map<string, { url: string; width: number; height: number }>> {
  /**
   * Une liste d'univers VIDE veut dire « sans distinction », pas « aucune ».
   *
   * `a.audience = ANY('{}')` n'est vrai pour aucune ligne : passer un tableau
   * vide ne relâchait pas la restriction, il rendait zéro visuel. Les cartes
   * de rayon seraient alors restées au lavis pour toujours sur une boutique
   * non triée — alors que les photographies existent et qu'on peut les
   * montrer.
   */
  const restrictionUnivers =
    audiences.length === 0
      ? Prisma.empty
      : Prisma.sql`AND a.audience = ANY(${[...audiences]}::text[])`

  const rows = await prisma.$queryRaw<
    { slug: string; url: string; width: number; height: number }[]
  >`
    SELECT DISTINCT ON (c.slug)
           c.slug  AS slug,
           i.url   AS url,
           i.width AS width,
           i.height AS height
    FROM "Article" a
    JOIN "Category" c ON c.id = a."categoryId"
    JOIN LATERAL (
      SELECT url, width, height
      FROM "ArticleImage"
      WHERE "articleId" = a.id
      ORDER BY position ASC
      LIMIT 1
    ) i ON true
    WHERE a.status = ANY(${[...LISTED_STATUSES]}::"ArticleStatus"[])
      AND a."publishedAt" IS NOT NULL
      AND a."publishedAt" <= now()
      ${restrictionUnivers}
    ORDER BY c.slug, a."publishedAt" DESC
  `

  return new Map(
    rows.map((row) => [
      row.slug,
      { url: row.url, width: row.width, height: row.height },
    ]),
  )
}

/**
 * Y a-t-il seulement quelque chose à trier dans cet univers ?
 *
 * ---------------------------------------------------------------------------
 * Ce que cette question évite
 * ---------------------------------------------------------------------------
 * La page `/femme` impose son univers à tout ce qu'elle affiche. Tant qu'aucune
 * pièce ne porte « femme » ni « mixte », cette contrainte ne restreint rien :
 * elle VIDE. La boutique montrait donc « aucun article » sur une page dont
 * chaque rayon était pourtant plein — un magasin qui affiche « fermé » parce
 * que personne n'a encore posé les étiquettes de rayon.
 *
 * Un `COUNT` borné à un seul résultat suffit à trancher, et l'index
 * `(status, audience, publishedAt)` le sert directement. On ne compte pas les
 * pièces : on demande s'il en existe au moins une.
 */
export async function hasSortedAudiences(
  audiences: readonly string[],
  now = new Date(),
): Promise<boolean> {
  if (audiences.length === 0) return false

  const found = await prisma.article.findFirst({
    where: {
      audience: { in: [...audiences] },
      ...listedArticleWhere(now),
    },
    select: { id: true },
  })

  return found !== null
}
