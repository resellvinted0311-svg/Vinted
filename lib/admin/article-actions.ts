'use server'

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { parseAmountToCents } from '@/lib/domain/money'
import { routing } from '@/lib/i18n/routing'
import {
  createArticleSchema,
  updateArticleSchema,
  listingActionSchema,
  imageActionSchema,
  MEASUREMENT_LIMITS,
} from '@/lib/validation/article'
import { MEASUREMENT_KEYS, type MeasurementKey } from '@/lib/domain/vocabulary'
import {
  createShopArticle,
  updateShopArticle,
  applyListing,
  type ArticleWriteInput,
} from '@/lib/articles/persistence'
import { reorderArticleImage } from '@/lib/articles/images'

/**
 * Le catalogue, écrit depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Chacune des quatre actions commence donc par `requireAdmin()`.
 *
 * Le middleware protège `/admin`, mais une Server Action n'est pas une page :
 * elle est appelée par un POST vers l'URL de la page qui l'a rendue, et rien
 * n'oblige un appelant à passer par cette page. Ici l'enjeu est immédiat — sans
 * ce contrôle, n'importe qui publierait une pièce à un euro.
 *
 * ---------------------------------------------------------------------------
 * Aucun montant n'est REÇU du client
 * ---------------------------------------------------------------------------
 * Ce qui traverse le réseau est la CHAÎNE tapée — « 24,50 » — et
 * `parseAmountToCents` en fait des centimes ici. Le prix plancher, lui, n'est
 * pas transmis du tout : il est recalculé à chaque écriture depuis le coût
 * d'achat et le poids, et un prix de vente en dessous est refusé.
 */

export type ArticleActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'created'; articleId: string }
  | { status: 'saved' }
  | { status: 'listed'; to: 'AVAILABLE' | 'ARCHIVED'; voidedOffers: number }
  | { status: 'imageChanged' }

const ERROR = (messageKey: string): ArticleActionState => ({
  status: 'error',
  messageKey,
})

/** Un champ laissé vide arrive comme une chaîne VIDE, jamais comme `undefined`. */
function optional(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function readMeasurements(
  formData: FormData,
): Record<string, string> | undefined {
  const found: Record<string, string> = {}
  for (const key of MEASUREMENT_KEYS) {
    const raw = optional(formData.get(`measure.${key}`))
    if (raw !== undefined) found[key] = raw
  }
  return Object.keys(found).length === 0 ? undefined : found
}

/** Les champs communs aux deux formulaires, lus par NOM, jamais en bouclant. */
function readFields(formData: FormData) {
  return {
    categoryId: formData.get('categoryId'),
    brandName: optional(formData.get('brandName')),
    condition: formData.get('condition'),
    sizeLabel: formData.get('sizeLabel'),
    color: optional(formData.get('color')),
    material: optional(formData.get('material')),
    fit: optional(formData.get('fit')),
    title: formData.get('title'),
    description: optional(formData.get('description')),
    priceEuros: formData.get('priceEuros'),
    costEuros: formData.get('costEuros'),
    weightGrams: formData.get('weightGrams'),
    // Une case décochée n'est pas envoyée : son absence vaut « non ».
    allowOffers: formData.get('allowOffers') !== null,
    autoDropEnabled: formData.get('autoDropEnabled') !== null,
    sourcedFrom: optional(formData.get('sourcedFrom')),
    internalNotes: optional(formData.get('internalNotes')),
    measurements: readMeasurements(formData),
  }
}

/**
 * Convertit les chaînes saisies en valeurs de domaine.
 *
 * Les montants et les mesures se tapent avec la virgule ou le point selon la
 * langue et le clavier. Les convertir dans le navigateur reviendrait à faire
 * confiance à sa locale pour décider si « 1.500 » vaut un euro cinquante ou
 * mille cinq cents euros.
 */
function toWriteInput(
  parsed: {
    categoryId: string
    brandName?: string | undefined
    condition: ArticleWriteInput['condition']
    sizeLabel: string
    color?: ArticleWriteInput['color']
    material?: ArticleWriteInput['material']
    fit?: ArticleWriteInput['fit']
    title: string
    description?: string | undefined
    priceEuros: string
    costEuros: string
    weightGrams: number
    allowOffers: boolean
    autoDropEnabled: boolean
    sourcedFrom?: string | undefined
    internalNotes?: string | undefined
    measurements?: Partial<Record<MeasurementKey, string>> | undefined
  },
): ArticleWriteInput | { invalid: string } {
  const priceCents = parseAmountToCents(parsed.priceEuros)
  if (!Number.isFinite(priceCents)) return { invalid: 'invalidPrice' }

  const costCents = parseAmountToCents(parsed.costEuros)
  if (!Number.isFinite(costCents)) return { invalid: 'invalidCost' }

  const measurements: Partial<Record<MeasurementKey, number>> = {}
  for (const [key, raw] of Object.entries(parsed.measurements ?? {})) {
    const value = Number(String(raw).replace(',', '.'))
    if (!Number.isFinite(value)) return { invalid: 'invalidMeasurement' }
    if (value < MEASUREMENT_LIMITS.min || value > MEASUREMENT_LIMITS.max) {
      return { invalid: 'invalidMeasurement' }
    }
    measurements[key as MeasurementKey] = value
  }

  return {
    categoryId: parsed.categoryId,
    brandName: parsed.brandName,
    condition: parsed.condition,
    sizeLabel: parsed.sizeLabel,
    color: parsed.color,
    material: parsed.material,
    fit: parsed.fit,
    title: parsed.title,
    description: parsed.description,
    priceCents,
    costCents,
    weightGrams: parsed.weightGrams,
    allowOffers: parsed.allowOffers,
    autoDropEnabled: parsed.autoDropEnabled,
    sourcedFrom: parsed.sourcedFrom,
    internalNotes: parsed.internalNotes,
    measurements: Object.keys(measurements).length === 0 ? undefined : measurements,
  }
}

/**
 * Invalidation NOMMÉE, jamais `revalidatePath('/', 'layout')`.
 *
 * Purger toute la mise en page racine effacerait les pages prérendues du site
 * entier. Sur un chemin ouvert au public, c'est un levier de déni de service ;
 * ici l'appelant est authentifié, mais la règle vaut quand même — le catalogue
 * cesserait d'être servi depuis le cache pour rien.
 *
 * Ce qui est réellement en cache : l'accueil et la fiche article (soixante
 * secondes), la page des marques (cinq minutes, compteurs par maison). Le
 * catalogue et les pages de catégorie lisent `searchParams` et sont donc déjà
 * rendus à chaque requête — les invalider ne coûterait rien mais ne prouverait
 * rien non plus.
 */
function revalidateArticle(slug: string): void {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}`)
    revalidatePath(`/${locale}/a/${slug}`)
    revalidatePath(`/${locale}/marques`)
  }
}

async function guard(action: string): Promise<{ id: string } | null> {
  const admin = await requireAdmin()

  // Le plafond ne protège pas d'une administratrice malveillante — rien ne le
  // peut à ce niveau de droits — mais du script qui boucle : chaque écriture
  // ouvre une transaction, et la production n'accorde qu'une connexion par
  // instance.
  const allowed = await checkRateLimit({
    key: `article-${action}:${admin.id}`,
    limit: 300,
    windowSeconds: 3600,
    sensitive: true,
  })

  return allowed ? { id: admin.id } : null
}

export async function createArticleAction(
  _previous: ArticleActionState,
  formData: FormData,
): Promise<ArticleActionState> {
  if (!(await guard('create'))) return ERROR('rateLimited')

  const parsed = createArticleSchema.safeParse(readFields(formData))
  if (!parsed.success) return ERROR('invalidRequest')

  const input = toWriteInput(parsed.data)
  if ('invalid' in input) return ERROR(input.invalid)

  const result = await createShopArticle(input)
  if (!result.ok) return ERROR(result.reason)

  // Pas d'invalidation ici : une pièce naît en BROUILLON, donc invisible du
  // public. Rien de ce qui est en cache ne la montre encore.
  return { status: 'created', articleId: result.articleId }
}

export async function updateArticleAction(
  _previous: ArticleActionState,
  formData: FormData,
): Promise<ArticleActionState> {
  if (!(await guard('update'))) return ERROR('rateLimited')

  const articleId = formData.get('articleId')
  if (typeof articleId !== 'string' || articleId === '') {
    return ERROR('invalidRequest')
  }

  const parsed = updateArticleSchema.safeParse({
    ...readFields(formData),
    expectedUpdatedAt: formData.get('expectedUpdatedAt'),
  })
  if (!parsed.success) return ERROR('invalidRequest')

  const input = toWriteInput(parsed.data)
  if ('invalid' in input) return ERROR(input.invalid)

  const result = await updateShopArticle(
    articleId,
    input,
    parsed.data.expectedUpdatedAt,
  )
  if (!result.ok) return ERROR(result.reason)

  revalidateArticle(result.slug)
  return { status: 'saved' }
}

export async function listArticleAction(
  _previous: ArticleActionState,
  formData: FormData,
): Promise<ArticleActionState> {
  if (!(await guard('list'))) return ERROR('rateLimited')

  const parsed = listingActionSchema.safeParse({
    articleId: formData.get('articleId'),
    action: formData.get('action'),
  })
  if (!parsed.success) return ERROR('invalidRequest')

  const result = await applyListing(parsed.data.articleId, parsed.data.action)
  if (!result.ok) return ERROR(result.reason)

  const slug = formData.get('slug')
  if (typeof slug === 'string' && slug !== '') revalidateArticle(slug)

  return {
    status: 'listed',
    to: result.status,
    voidedOffers: result.voidedOffers,
  }
}

export async function reorderImageAction(
  _previous: ArticleActionState,
  formData: FormData,
): Promise<ArticleActionState> {
  if (!(await guard('image'))) return ERROR('rateLimited')

  const parsed = imageActionSchema.safeParse({
    imageId: formData.get('imageId'),
    action: formData.get('action'),
  })
  if (!parsed.success) return ERROR('invalidRequest')

  const result = await reorderArticleImage(parsed.data.imageId, parsed.data.action)
  if (!result.ok) return ERROR(result.reason)

  const slug = formData.get('slug')
  if (typeof slug === 'string' && slug !== '') revalidateArticle(slug)

  return { status: 'imageChanged' }
}
