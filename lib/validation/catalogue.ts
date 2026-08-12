import { z } from 'zod'
import {
  SORT_KEYS,
  DEFAULT_SORT,
  normalizePriceRange,
  type CatalogueFilters,
  type SortKey,
} from '@/lib/domain/catalogue'

/**
 * Validation des paramètres d'URL du catalogue.
 *
 * Ces valeurs viennent du navigateur : elles sont validées avant toute
 * requête, même pour une simple lecture. Une valeur aberrante est ignorée
 * plutôt que de faire échouer la page — une URL bricolée doit afficher le
 * catalogue, pas une erreur 500.
 */

/** Un slug ne contient que minuscules, chiffres et tirets. */
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,80}$/)

/** Les tailles remontent telles quelles de l'étiquette : plus permissif. */
const sizeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9 .,/-]{1,16}$/)

const conditionSchema = z.enum([
  'NEW_WITH_TAGS',
  'NEW_WITHOUT_TAGS',
  'VERY_GOOD',
  'GOOD',
  'FAIR',
])

const attributeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,40}$/)

/** Prix saisis en euros dans l'URL, convertis en centimes. */
const priceSchema = z.coerce.number().finite().min(0).max(100_000)

/**
 * Accepte une valeur unique ou répétée (`?cat=a&cat=b`) et rejette
 * silencieusement les entrées invalides, en bornant le nombre de valeurs :
 * sans borne, une URL avec 5 000 valeurs génèrerait une requête ingérable.
 */
function multi<T extends z.ZodType>(schema: T, max = 20) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value): z.infer<T>[] => {
      if (value === undefined) return []
      const raw = Array.isArray(value) ? value : [value]

      const parsed = raw
        .map((entry) => schema.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => result.data as z.infer<T>)

      return [...new Set(parsed)].slice(0, max)
    })
}

function optionalNumber(schema: z.ZodType<number>) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return null
      const first = Array.isArray(value) ? value[0] : value
      if (first === undefined || first.trim() === '') return null
      const result = schema.safeParse(first)
      return result.success ? result.data : null
    })
}

export const catalogueSearchParamsSchema = z.object({
  cat: multi(slugSchema),
  marque: multi(slugSchema),
  taille: multi(sizeSchema),
  etat: multi(conditionSchema),
  couleur: multi(attributeSchema),
  matiere: multi(attributeSchema),
  prix_min: optionalNumber(priceSchema),
  prix_max: optionalNumber(priceSchema),
  q: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      const first = Array.isArray(value) ? value[0] : value
      const trimmed = first?.trim() ?? ''
      // Une recherche d'un seul caractère ramènerait tout le catalogue.
      return trimmed.length >= 2 ? trimmed.slice(0, 100) : null
    }),
  tri: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value): SortKey => {
      const first = Array.isArray(value) ? value[0] : value
      return SORT_KEYS.includes(first as SortKey)
        ? (first as SortKey)
        : DEFAULT_SORT
    }),
  apres: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      const first = Array.isArray(value) ? value[0] : value
      return first && first.length <= 200 ? first : null
    }),
})

export interface ParsedCatalogueParams {
  filters: CatalogueFilters
  sort: SortKey
  cursor: string | null
}

/** Ne lève jamais : une URL invalide retombe sur le catalogue par défaut. */
export function parseCatalogueSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ParsedCatalogueParams {
  const parsed = catalogueSearchParamsSchema.safeParse(raw)

  if (!parsed.success) {
    return {
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
      sort: DEFAULT_SORT,
      cursor: null,
    }
  }

  const data = parsed.data

  // Les prix arrivent en euros dans l'URL (lisible et partageable) mais tout
  // le domaine raisonne en centimes.
  const { minPriceCents, maxPriceCents } = normalizePriceRange(
    data.prix_min === null ? null : Math.round(data.prix_min * 100),
    data.prix_max === null ? null : Math.round(data.prix_max * 100),
  )

  return {
    filters: {
      categorySlugs: data.cat,
      brandSlugs: data.marque,
      sizes: data.taille,
      conditions: data.etat,
      colors: data.couleur,
      materials: data.matiere,
      minPriceCents,
      maxPriceCents,
      query: data.q,
    },
    sort: data.tri,
    cursor: data.apres,
  }
}

export const autocompleteSchema = z.object({
  q: z.string().trim().min(2).max(100),
  locale: z.string().length(2),
})
