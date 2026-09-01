/**
 * Catalogue — logique pure de filtrage, tri et pagination.
 *
 * Aucune dépendance à Prisma ni à Next : ce module se teste sans base de
 * données. Les requêtes SQL sont construites ailleurs, à partir de ces
 * structures normalisées.
 */

export const SORT_KEYS = ['nouveautes', 'prix_asc', 'prix_desc', 'baisse'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export const DEFAULT_SORT: SortKey = 'nouveautes'

/**
 * Nombre d'articles par lot.
 *
 * Trente, et non plus vingt-quatre : c'est le rythme demandé, et il tombe juste
 * sur les trois largeurs de la grille — deux, trois et quatre colonnes — donc
 * aucune rangée incomplète ne vient couper la lecture avant le bouton.
 *
 * « Par lot » et non « par page » depuis que « Voir la suite » ajoute les
 * pièces SOUS les précédentes au lieu de changer de page. Le mot compte : rien
 * ne remplace rien, tout s'accumule.
 */
export const PAGE_SIZE = 30

export interface CatalogueFilters {
  categorySlugs: string[]
  brandSlugs: string[]
  sizes: string[]
  conditions: string[]
  colors: string[]
  materials: string[]
  minPriceCents: number | null
  maxPriceCents: number | null
  query: string | null
}

export const EMPTY_FILTERS: CatalogueFilters = {
  categorySlugs: [],
  brandSlugs: [],
  sizes: [],
  conditions: [],
  colors: [],
  materials: [],
  minPriceCents: null,
  maxPriceCents: null,
  query: null,
}

export function hasActiveFilters(filters: CatalogueFilters): boolean {
  return (
    filters.categorySlugs.length > 0 ||
    filters.brandSlugs.length > 0 ||
    filters.sizes.length > 0 ||
    filters.conditions.length > 0 ||
    filters.colors.length > 0 ||
    filters.materials.length > 0 ||
    filters.minPriceCents !== null ||
    filters.maxPriceCents !== null ||
    (filters.query !== null && filters.query.length > 0)
  )
}

/**
 * Curseur de pagination.
 *
 * Pas d'OFFSET : sur un catalogue où les articles se vendent en continu, un
 * OFFSET fait sauter ou dupliquer des lignes entre deux pages. Le curseur
 * porte la valeur de tri ET l'identifiant, ce dernier départageant les
 * ex æquo — sans lui, deux articles au même prix peuvent se masquer
 * mutuellement d'une page à l'autre.
 */
export interface Cursor {
  /** Valeur de la colonne de tri : horodatage en millisecondes ou centimes. */
  value: number
  id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.value}:${cursor.id}`, 'utf8').toString(
    'base64url',
  )
}

/** Renvoie `null` sur curseur illisible plutôt que de lever : une URL
 *  partagée puis tronquée doit afficher la première page, pas une erreur. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null

  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator <= 0) return null

    const value = Number(decoded.slice(0, separator))
    const id = decoded.slice(separator + 1)

    // `Number.isFinite` laisse passer 1e30. La valeur part ensuite en
    // paramètre lié vers un cast `::bigint` qui déborde, et PostgreSQL répond
    // « bigint out of range » : une URL forgée renvoyait donc une 500 sur les
    // trois pages publiques indexées — catalogue, catégorie, marque. Un lien
    // partagé n'importe où cassait la page pour tous ses visiteurs.
    //
    // `isSafeInteger` refuse les flottants et les entiers hors portée. La
    // borne explicite couvre en plus les valeurs représentables en JavaScript
    // mais absurdes comme date en millisecondes ou comme montant.
    if (!Number.isSafeInteger(value)) return null
    if (Math.abs(value) > 8.64e15) return null

    // Un identifiant est un cuid : borner sa longueur évite d'envoyer une
    // chaîne arbitraire dans une requête.
    if (id.length === 0 || id.length > 64) return null

    return { value, id }
  } catch {
    return null
  }
}

export interface SortSpec {
  /** Colonne de tri côté base. */
  column: 'publishedAt' | 'priceCents' | 'lastPriceDropAt'
  direction: 'asc' | 'desc'
}

export function sortSpec(sort: SortKey): SortSpec {
  switch (sort) {
    case 'prix_asc':
      return { column: 'priceCents', direction: 'asc' }
    case 'prix_desc':
      return { column: 'priceCents', direction: 'desc' }
    case 'baisse':
      return { column: 'lastPriceDropAt', direction: 'desc' }
    case 'nouveautes':
      return { column: 'publishedAt', direction: 'desc' }
  }
}

/** Extrait la valeur de curseur d'un article, selon le tri courant. */
export function cursorValueFor(
  sort: SortKey,
  article: {
    id: string
    priceCents: number
    publishedAt: Date | null
    lastPriceDropAt?: Date | null
  },
): Cursor {
  const spec = sortSpec(sort)

  const value =
    spec.column === 'priceCents'
      ? article.priceCents
      : spec.column === 'publishedAt'
        ? (article.publishedAt?.getTime() ?? 0)
        : (article.lastPriceDropAt?.getTime() ?? 0)

  return { value, id: article.id }
}

/**
 * Traduit une fourchette de prix saisie en euros vers des centimes bornés.
 *
 * Une borne min supérieure à la borne max est corrigée par échange plutôt que
 * par rejet : la personne a manifestement inversé les deux champs, lui
 * renvoyer une erreur ne l'aide pas.
 */
export function normalizePriceRange(
  min: number | null,
  max: number | null,
): { minPriceCents: number | null; maxPriceCents: number | null } {
  const lo = min !== null && Number.isFinite(min) ? Math.max(0, Math.round(min)) : null
  const hi = max !== null && Number.isFinite(max) ? Math.max(0, Math.round(max)) : null

  if (lo !== null && hi !== null && lo > hi) {
    return { minPriceCents: hi, maxPriceCents: lo }
  }
  return { minPriceCents: lo, maxPriceCents: hi }
}

/**
 * Sérialise les filtres en paramètres d'URL.
 *
 * L'état du catalogue vit dans l'URL : elle doit rester partageable et
 * indexable. Les valeurs vides sont omises pour qu'une même sélection
 * produise toujours exactement la même adresse (pas de contenu dupliqué).
 */
export function filtersToSearchParams(
  filters: CatalogueFilters,
  sort: SortKey,
  cursor?: string | null,
): URLSearchParams {
  const params = new URLSearchParams()

  const appendAll = (key: string, values: string[]): void => {
    for (const value of [...values].sort()) params.append(key, value)
  }

  appendAll('cat', filters.categorySlugs)
  appendAll('marque', filters.brandSlugs)
  appendAll('taille', filters.sizes)
  appendAll('etat', filters.conditions)
  appendAll('couleur', filters.colors)
  appendAll('matiere', filters.materials)

  if (filters.minPriceCents !== null) {
    params.set('prix_min', String(filters.minPriceCents))
  }
  if (filters.maxPriceCents !== null) {
    params.set('prix_max', String(filters.maxPriceCents))
  }
  if (filters.query) params.set('q', filters.query)
  if (sort !== DEFAULT_SORT) params.set('tri', sort)
  if (cursor) params.set('apres', cursor)

  return params
}

/** Retire une valeur d'un filtre — sert aux chips « filtres actifs ». */
export function withoutFilterValue(
  filters: CatalogueFilters,
  key: keyof CatalogueFilters,
  value: string,
): CatalogueFilters {
  const current = filters[key]

  if (Array.isArray(current)) {
    return { ...filters, [key]: current.filter((entry) => entry !== value) }
  }
  return { ...filters, [key]: null }
}
