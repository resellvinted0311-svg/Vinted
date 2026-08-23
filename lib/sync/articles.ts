import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { SITE } from '@/lib/config/site'
import { getPricingConfig, getSettings } from '@/lib/config/settings'
import {
  computeFloorPriceCents,
  computeNetMarginCents,
  type PricingConfig,
} from '@/lib/domain/pricing'
import { MEASUREMENT_KEYS, type MeasurementKey } from '@/lib/domain/vocabulary'
import { routing } from '@/lib/i18n/routing'
import { enqueue } from '@/lib/jobs/queue'
import {
  detailForIssue,
  reasonForIssue,
  syncArticleSchema,
  type SyncArticleInput,
  type SyncRejectionReason,
} from '@/lib/validation/sync'
import { composeDescription } from './description'
import { allocateInventoryNumber, buildArticleSlug, slugify } from './identifiers'

/**
 * Import d'inventaire — le cœur de `POST /api/sync/articles`.
 *
 * Contrat complet : `docs/synchronisation.md`. Ce module l'applique pièce par
 * pièce ; la route HTTP au-dessus ne fait qu'authentifier, limiter le débit et
 * choisir un code de statut.
 *
 * ---------------------------------------------------------------------------
 * Une transaction PAR PIÈCE, jamais une pour le lot
 * ---------------------------------------------------------------------------
 * Cent pièces dans une seule transaction, c'est cent pièces perdues quand la
 * quatre-vingt-dix-septième a une couleur inconnue. Le contrat promet
 * l'inverse : « une pièce rejetée n'annule pas les autres ».
 *
 * Le prix est assumé : le lot n'est pas atomique. C'est exactement ce qu'on
 * veut d'un import — on renvoie ce qui est passé, ce qui ne l'est pas, et
 * pourquoi.
 *
 * ---------------------------------------------------------------------------
 * Le contexte est lu UNE fois, avant la boucle
 * ---------------------------------------------------------------------------
 * Réglages, grille de port, arbre des catégories : identiques pour les cent
 * pièces. Les relire à chaque tour multiplierait les allers-retours par cent,
 * derrière un pooler qui n'autorise qu'une connexion.
 *
 * Et surtout : lus une fois, ils sont COHÉRENTS. Relus au fil du lot, une
 * modification en back-office au milieu de l'import ferait calculer les
 * cinquante premières pièces avec une marge minimale et les cinquante suivantes
 * avec une autre, sans que rien ne le signale.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module ne fait pas
 * ---------------------------------------------------------------------------
 * Il ne télécharge aucune image. Trois cents téléchargements dépasseraient le
 * temps imparti à une fonction serverless, et l'application attendrait une
 * réponse qui n'arriverait jamais. La pièce est créée en brouillon, un travail
 * est inscrit, et la fiche se publie seule quand ses visuels sont stockés.
 * Aucune fiche n'est publiée sans visuel.
 */

// ---------------------------------------------------------------------------
// Ce que la route renvoie
// ---------------------------------------------------------------------------

export type SyncAction =
  | 'created'
  | 'updated'
  | 'rejected'
  | 'would-create'
  | 'would-update'

export interface SyncResult {
  externalId: string
  action: SyncAction

  /** Présents dès que la pièce existe ou existerait. */
  sku?: string
  slug?: string
  url?: string

  /** Économie de la pièce — calculée même en essai à blanc. */
  floorPriceCents?: number
  belowFloor?: boolean
  estimatedMarginCents?: number

  /** Les visuels sont-ils encore en attente de téléchargement ? */
  imagesPending?: boolean
  /** La fiche est-elle visible du public à cet instant ? */
  published?: boolean

  /** Renseignés uniquement sur `rejected`. */
  reason?: SyncRejectionReason
  detail?: string
  /** Échéance du verrou de caisse, sur `locked-by-checkout`. */
  lockedUntil?: string
}

// ---------------------------------------------------------------------------
// Contexte du lot
// ---------------------------------------------------------------------------

interface CategoryEntry {
  id: string
  slug: string
  /** Une catégorie parente n'accueille aucune pièce. */
  isLeaf: boolean
  /** Nom par langue, pour composer une description à défaut d'en recevoir. */
  nameByLocale: Map<string, string>
}

export interface SyncContext {
  pricing: PricingConfig
  packagingWeightGrams: number
  offersOpenAfterDays: number
  /**
   * Paliers de la zone de référence, triés par poids croissant.
   *
   * Sert à deux choses opposées : refuser un colis qu'aucun palier ne couvre,
   * et estimer le coût transporteur qui entre dans le prix plancher.
   */
  floorRates: readonly { maxWeightGrams: number; priceCents: number }[]
  floorZoneCode: string
  categories: Map<string, CategoryEntry>
}

export async function loadSyncContext(): Promise<SyncContext> {
  const [pricing, settings] = await Promise.all([
    getPricingConfig(),
    getSettings([
      'packagingWeightGrams',
      'offersOpenAfterDays',
      'floorShippingZoneCode',
    ]),
  ])

  const [rateRows, categoryRows] = await Promise.all([
    prisma.shippingRate.findMany({
      where: { active: true, zone: { code: settings.floorShippingZoneCode } },
      orderBy: { maxWeightGrams: 'asc' },
      select: { maxWeightGrams: true, priceCents: true },
    }),
    prisma.category.findMany({
      select: {
        id: true,
        slug: true,
        _count: { select: { children: true } },
        translations: { select: { locale: true, name: true } },
      },
    }),
  ])

  const categories = new Map<string, CategoryEntry>()
  for (const row of categoryRows) {
    categories.set(row.slug, {
      id: row.id,
      slug: row.slug,
      isLeaf: row._count.children === 0,
      nameByLocale: new Map(row.translations.map((t) => [t.locale, t.name])),
    })
  }

  return {
    pricing,
    packagingWeightGrams: settings.packagingWeightGrams,
    offersOpenAfterDays: settings.offersOpenAfterDays,
    floorRates: rateRows,
    floorZoneCode: settings.floorShippingZoneCode,
    categories,
  }
}

// ---------------------------------------------------------------------------
// Une pièce
// ---------------------------------------------------------------------------

function rejected(
  externalId: string,
  reason: SyncRejectionReason,
  detail: string,
  extra: { lockedUntil?: string } = {},
): SyncResult {
  return { externalId, action: 'rejected', reason, detail, ...extra }
}

/**
 * Identifiant lisible d'une entrée dont on n'a pas pu lire l'`externalId`.
 *
 * Sans lui, une entrée mal formée renverrait `"externalId": undefined` et
 * l'application n'aurait aucun moyen de savoir LAQUELLE de ses cent pièces a
 * été refusée. On retombe donc sur sa position dans le lot.
 */
function externalIdOf(raw: unknown, index: number): string {
  if (raw && typeof raw === 'object' && 'externalId' in raw) {
    const value = (raw as { externalId: unknown }).externalId
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return `#${index + 1}`
}

export interface SyncOptions {
  /** Valide, calcule, renvoie — mais n'écrit rien. */
  dryRun: boolean
}

export async function syncArticle(
  raw: unknown,
  index: number,
  context: SyncContext,
  options: SyncOptions,
): Promise<SyncResult> {
  const parsed = syncArticleSchema.safeParse(raw)

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (!issue) {
      return rejected(externalIdOf(raw, index), 'invalid-field', 'entrée illisible')
    }
    return rejected(
      externalIdOf(raw, index),
      reasonForIssue(issue),
      detailForIssue(issue),
    )
  }

  const input = parsed.data

  // ---- Catégorie ---------------------------------------------------------
  const category = context.categories.get(input.categorySlug)
  if (!category) {
    return rejected(
      input.externalId,
      'unknown-category',
      `« ${input.categorySlug} » n’existe pas dans le catalogue`,
    )
  }
  if (!category.isLeaf) {
    return rejected(
      input.externalId,
      'unknown-category',
      `« ${input.categorySlug} » est une catégorie parente ; seules les feuilles accueillent des pièces`,
    )
  }

  // ---- Poids et coût transporteur ----------------------------------------
  //
  // Le palier s'applique au COLIS, emballage compris. Vérifier le poids de la
  // pièce seule laisserait passer une pièce de 4 980 g qui, une fois emballée,
  // ne trouverait aucun tarif — et le refus tomberait à l'étape du paiement,
  // devant l'acheteuse, au lieu de tomber ici.
  const parcelWeightGrams = input.weightGrams + context.packagingWeightGrams
  const carrierCostCents = cheapestCoveringRate(
    context.floorRates,
    parcelWeightGrams,
  )

  if (carrierCostCents === null) {
    const heaviest = context.floorRates.at(-1)?.maxWeightGrams ?? 0
    return rejected(
      input.externalId,
      'weight-not-covered',
      `${parcelWeightGrams} g (dont ${context.packagingWeightGrams} g d’emballage) dépasse le palier le plus lourd de la zone ${context.floorZoneCode} (${heaviest} g)`,
    )
  }

  // ---- Économie de la pièce ----------------------------------------------
  const floorPriceCents = computeFloorPriceCents(
    {
      costCents: input.costCents,
      estimatedShippingCostCents: carrierCostCents,
    },
    context.pricing,
  )

  const estimatedMarginCents = computeNetMarginCents(
    {
      salePriceCents: input.priceCents,
      costCents: input.costCents,
      shippingCostCents: carrierCostCents,
    },
    context.pricing,
  )

  const economics = {
    floorPriceCents,
    // Sous le plancher, la pièce est QUAND MÊME publiée : brader une pièce est
    // une décision commerciale, elle appartient au vendeur. Ce qu'on doit, ce
    // n'est pas un refus, c'est un chiffre exact — et il peut être négatif.
    belowFloor: input.priceCents < floorPriceCents,
    estimatedMarginCents,
  }

  // ---- État actuel de la pièce -------------------------------------------
  const existing = await prisma.article.findUnique({
    where: { externalId: input.externalId },
    select: {
      id: true,
      sku: true,
      slug: true,
      status: true,
      publishedAt: true,
      reservedUntil: true,
      images: {
        orderBy: { position: 'asc' },
        select: { sourceUrl: true },
      },
    },
  })

  const wantsArchived = input.status === 'ARCHIVED'

  if (existing) {
    // Vendue : plus rien ne s'écrit dessus.
    //
    // Le prix, le titre et la description d'une pièce vendue figurent déjà,
    // FIGÉS, sur une commande et sur une facture qu'une cliente détient. Les
    // réécrire ne changerait pas ces documents mais ferait diverger la fiche
    // publique de ce qui a réellement été vendu, et un litige se jugerait sur
    // deux versions contradictoires du même article.
    if (existing.status === 'SOLD') {
      return rejected(
        input.externalId,
        'already-sold',
        'pièce vendue : son inventaire est clos, et la vente vous est annoncée par l’événement de vente',
      )
    }

    // Réservée ET on demande de l'archiver : quelqu'un est à l'étape du
    // paiement, carte en main. Le contrat impose le refus, avec l'échéance.
    if (existing.status === 'RESERVED' && wantsArchived) {
      return rejected(
        input.externalId,
        'locked-by-checkout',
        'pièce en cours de paiement : l’archivage est refusé jusqu’à l’échéance du verrou',
        { lockedUntil: existing.reservedUntil?.toISOString() },
      )
    }
  }

  // ---- Essai à blanc -----------------------------------------------------
  if (options.dryRun) {
    return existing
      ? {
          externalId: input.externalId,
          action: 'would-update',
          sku: existing.sku,
          slug: existing.slug,
          url: publicUrlFor(existing.slug),
          ...economics,
          imagesPending:
            imagesChanged(existing.images, input.images) ||
            existing.images.length === 0,
          published: existing.status === 'AVAILABLE',
        }
      : {
          externalId: input.externalId,
          action: 'would-create',
          // Ni `sku` ni `slug` : ils n'existent pas, et un essai à blanc n'en
          // consomme pas. En inventer un ici serait pire qu'une absence — il
          // ne serait pas celui attribué à l'écriture réelle.
          ...economics,
          imagesPending: true,
          published: false,
        }
  }

  // ---- Écriture ----------------------------------------------------------
  return existing
    ? updateArticle(input, existing, category, economics, context)
    : createArticle(input, category, economics)
}

interface Economics {
  floorPriceCents: number
  belowFloor: boolean
  estimatedMarginCents: number
}

/** Le tarif le moins cher dont le palier couvre ce poids, ou `null`. */
function cheapestCoveringRate(
  rates: readonly { maxWeightGrams: number; priceCents: number }[],
  parcelWeightGrams: number,
): number | null {
  const covering = rates
    .filter((rate) => rate.maxWeightGrams >= parcelWeightGrams)
    .map((rate) => rate.priceCents)

  // Aucune extrapolation au-delà du dernier palier : inventer un tarif, c'est
  // facturer un port que personne n'a négocié, et le payer soi-même.
  return covering.length === 0 ? null : Math.min(...covering)
}

function publicUrlFor(slug: string): string {
  return `${SITE.url}/${routing.defaultLocale}/a/${slug}`
}

/** Les visuels demandés diffèrent-ils de ceux réellement stockés ? */
function imagesChanged(
  stored: readonly { sourceUrl: string | null }[],
  wanted: readonly string[],
): boolean {
  if (stored.length !== wanted.length) return true
  return stored.some((image, index) => image.sourceUrl !== wanted[index])
}

// ---------------------------------------------------------------------------
// Champs communs à la création et à la mise à jour
// ---------------------------------------------------------------------------

function attributeFields(input: SyncArticleInput, categoryId: string) {
  return {
    categoryId,
    condition: input.condition,
    sizeLabel: input.sizeLabel,
    // Forme canonique des filtres et des alertes taille : « m » et « M »
    // doivent tomber sur la même facette.
    sizeNormalized: input.sizeLabel.toUpperCase(),
    color: input.color ?? null,
    material: input.material ?? null,
    fit: input.fit ?? null,
    priceCents: input.priceCents,
    comparePriceCents: input.comparePriceCents ?? null,
    costCents: input.costCents,
    weightGrams: input.weightGrams,
    externalSyncedAt: new Date(),
  }
}

/**
 * Retrouve ou crée la marque.
 *
 * La comparaison est insensible à la casse : « ralph lauren » et « Ralph
 * Lauren » sont la même maison, et deux fiches marque pour un même nom
 * couperaient le catalogue en deux.
 */
async function resolveBrandId(
  tx: Prisma.TransactionClient,
  brandName: string | undefined,
): Promise<string | null> {
  if (!brandName) return null

  const found = await tx.brand.findFirst({
    where: { name: { equals: brandName, mode: 'insensitive' } },
    select: { id: true },
  })
  if (found) return found.id

  const slug = slugify(brandName)
  if (!slug) return null

  try {
    const created = await tx.brand.create({
      data: { slug, name: brandName },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    // Deux lots concurrents peuvent créer la même marque : le second rattrape
    // la violation d'unicité et relit, plutôt que de faire échouer une pièce
    // pour une raison qui n'a rien à voir avec elle.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await tx.brand.findUnique({
        where: { slug },
        select: { id: true },
      })
      return existing?.id ?? null
    }
    throw error
  }
}

/**
 * Écrit les huit traductions.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi HUIT lignes et non une
 * ---------------------------------------------------------------------------
 * Le listing du catalogue joint `ArticleTranslation` en INNER JOIN sur la
 * locale demandée. Une pièce qui n'aurait qu'une ligne `fr` serait invisible
 * dans les sept autres catalogues — pas mal traduite : ABSENTE.
 *
 * Les sept autres portent donc le français, et `isFallback` le dit à la fiche,
 * qui l'affiche. Le jour où la traduction automatique sera branchée, elle
 * écrasera ces lignes et baissera le drapeau.
 *
 * ---------------------------------------------------------------------------
 * La description, elle, est composée dans CHAQUE langue
 * ---------------------------------------------------------------------------
 * Quand l'application n'en fournit pas, le relevé est assemblé à partir de
 * libellés déjà traduits huit fois. Une cliente néerlandaise lit donc un titre
 * français et un relevé néerlandais — et le vecteur de recherche néerlandais
 * contient de vrais mots néerlandais.
 */
async function writeTranslations(
  tx: Prisma.TransactionClient,
  articleId: string,
  input: SyncArticleInput,
  category: CategoryEntry,
  brandName: string | null,
): Promise<void> {
  const measurements = measurementList(input)

  for (const locale of routing.locales) {
    const description =
      input.description ??
      (await composeDescription(
        {
          categoryName:
            category.nameByLocale.get(locale) ??
            category.nameByLocale.get(routing.defaultLocale) ??
            category.slug,
          brandName,
          sizeLabel: input.sizeLabel,
          condition: input.condition,
          color: input.color ?? null,
          material: input.material ?? null,
          fit: input.fit ?? null,
          measurements,
        },
        locale,
      ))

    const isSourceLocale = locale === routing.defaultLocale

    const data = {
      title: input.title,
      description,
      // Rien n'a été traduit par machine : c'est du français d'origine, ou un
      // relevé assemblé à partir de libellés traduits à la main. Annoncer une
      // traduction automatique serait faux.
      isMachineTranslated: false,
      isFallback: !isSourceLocale,
    }

    await tx.articleTranslation.upsert({
      where: { articleId_locale: { articleId, locale } },
      create: { articleId, locale, ...data },
      update: data,
    })
  }
}

/**
 * Les mesures reçues, dans l'ordre CANONIQUE.
 *
 * L'ordre des clés d'un objet JSON est celui de son émetteur. Sans ce
 * réordonnancement, deux pièces identiques afficheraient leurs mesures dans
 * deux ordres différents selon la façon dont l'application a sérialisé — et le
 * relevé composé lirait « longueur, poitrine » sur l'une, « poitrine, longueur »
 * sur l'autre.
 */
function measurementList(
  input: SyncArticleInput,
): { key: MeasurementKey; valueCm: number }[] {
  const provided = input.measurements ?? {}

  return MEASUREMENT_KEYS.flatMap((key) => {
    const valueCm = provided[key]
    return typeof valueCm === 'number' ? [{ key, valueCm }] : []
  })
}

/**
 * Remplace les mesures par celles reçues.
 *
 * Les clés absentes sont SUPPRIMÉES, elles ne sont pas laissées en place : une
 * mesure corrigée en amont doit pouvoir être retirée, et une fiche qui garde
 * une valeur que l'application ne reconnaît plus ment sur la pièce.
 */
async function writeMeasurements(
  tx: Prisma.TransactionClient,
  articleId: string,
  input: SyncArticleInput,
): Promise<void> {
  const wanted = measurementList(input)
  const keys = wanted.map((m) => m.key)

  await tx.articleMeasurement.deleteMany({
    where: { articleId, key: { notIn: keys } },
  })

  for (const measurement of wanted) {
    await tx.articleMeasurement.upsert({
      where: { articleId_key: { articleId, key: measurement.key } },
      create: { articleId, key: measurement.key, valueCm: measurement.valueCm },
      update: { valueCm: measurement.valueCm },
    })
  }
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

async function createArticle(
  input: SyncArticleInput,
  category: CategoryEntry,
  economics: Economics,
): Promise<SyncResult> {
  return prisma.$transaction(async (tx) => {
    const brandId = await resolveBrandId(tx, input.brandName)
    const brand = brandId
      ? await tx.brand.findUnique({
          where: { id: brandId },
          select: { slug: true, name: true },
        })
      : null

    const { sku, sequence } = await allocateInventoryNumber(tx)

    const slug = buildArticleSlug({
      categorySlug: category.slug,
      brandSlug: brand?.slug ?? null,
      sizeLabel: input.sizeLabel,
      sequence,
    })

    const article = await tx.article.create({
      data: {
        sku,
        slug,
        externalId: input.externalId,
        brandId,
        ...attributeFields(input, category.id),
        floorPriceCents: economics.floorPriceCents,
        descriptionIsGenerated: input.description === undefined,
        // Brouillon, sans exception. La publication est prononcée par le
        // travail d'images, et seulement s'il en stocke au moins une : une
        // fiche de vêtement sans photo ne se vend pas, elle décrédibilise le
        // reste du catalogue.
        //
        // Une pièce envoyée déjà archivée naît archivée : le travail d'images
        // ne publiera pas ce qui n'est pas en brouillon.
        status: input.status === 'ARCHIVED' ? 'ARCHIVED' : 'DRAFT',
      },
      select: { id: true },
    })

    await writeTranslations(tx, article.id, input, category, brand?.name ?? null)
    await writeMeasurements(tx, article.id, input)

    await enqueue(tx, {
      type: 'article.images',
      payload: { articleId: article.id, urls: [...input.images] },
    })

    return {
      externalId: input.externalId,
      action: 'created' as const,
      sku,
      slug,
      url: publicUrlFor(slug),
      ...economics,
      imagesPending: true,
      published: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Mise à jour
// ---------------------------------------------------------------------------

interface ExistingArticle {
  id: string
  sku: string
  slug: string
  status: string
  publishedAt: Date | null
  images: readonly { sourceUrl: string | null }[]
}

async function updateArticle(
  input: SyncArticleInput,
  existing: ExistingArticle,
  category: CategoryEntry,
  economics: Economics,
  context: SyncContext,
): Promise<SyncResult> {
  return prisma.$transaction(async (tx) => {
    const brandId = await resolveBrandId(tx, input.brandName)
    const brand = brandId
      ? await tx.brand.findUnique({
          where: { id: brandId },
          select: { name: true },
        })
      : null

    const needsImages = imagesChanged(existing.images, input.images)
    const hasStoredImages = existing.images.length > 0

    const status = nextStatus({
      current: existing.status,
      wantsArchived: input.status === 'ARCHIVED',
      hasStoredImages,
    })

    /**
     * Première mise en ligne d'une pièce jamais publiée.
     *
     * Le cas qui l'a rendue nécessaire : une pièce envoyée d'emblée
     * `ARCHIVED`. Elle naît archivée, ses visuels se téléchargent, mais
     * `publishIfPending` ne la publie pas — elle n'est pas en brouillon. Sa
     * date de mise en ligne reste donc nulle.
     *
     * Le jour où l'application la remet en vente, le statut passait à
     * `AVAILABLE` sans que cette date soit posée. Or TOUTE la visibilité en
     * dépend : `lib/db/visibility.ts` exige `publishedAt IS NOT NULL`, et le
     * verrou de stock aussi. La pièce était donc « disponible » et pourtant
     * introuvable dans le catalogue, invisible sur sa fiche, et impossible à
     * mettre au panier — sans que rien ne le signale.
     */
    const firstPublication = status === 'AVAILABLE' && existing.publishedAt === null
    const now = new Date()

    await tx.article.update({
      where: { id: existing.id },
      data: {
        brandId,
        ...attributeFields(input, category.id),
        floorPriceCents: economics.floorPriceCents,
        descriptionIsGenerated: input.description === undefined,
        status,
        // Ni `sku`, ni `slug` : l'adresse publique d'une pièce ne bouge pas.
        //
        // `publishedAt` n'est écrite qu'à la PREMIÈRE mise en ligne : une pièce
        // déjà publiée garde sa date, qui sert au tri « nouveautés » et aux
        // dates de flux. La redater ferait remonter en tête du catalogue une
        // pièce dont on vient seulement de corriger le prix.
        ...(firstPublication
          ? {
              publishedAt: now,
              offersOpenAt: new Date(
                now.getTime() + context.offersOpenAfterDays * 24 * 60 * 60_000,
              ),
            }
          : {}),
      },
    })

    await writeTranslations(tx, existing.id, input, category, brand?.name ?? null)
    await writeMeasurements(tx, existing.id, input)

    if (needsImages) {
      // Les anciens visuels restent en place jusqu'à ce que les nouveaux
      // soient stockés : supprimer d'abord laisserait une fiche publiée sans
      // photo pendant tout le temps du téléchargement.
      await enqueue(tx, {
        type: 'article.images',
        payload: { articleId: existing.id, urls: [...input.images] },
      })
    }

    return {
      externalId: input.externalId,
      action: 'updated' as const,
      sku: existing.sku,
      slug: existing.slug,
      url: publicUrlFor(existing.slug),
      ...economics,
      imagesPending: needsImages || !hasStoredImages,
      published: status === 'AVAILABLE',
    }
  })
}

/**
 * Quel statut après une mise à jour ?
 *
 * Les trois règles, dans l'ordre :
 *
 *  1. l'archivage demandé l'emporte — c'est le seul changement d'état que
 *     l'application peut prononcer ;
 *  2. une pièce RÉSERVÉE ne bouge pas : son statut appartient à la caisse, et
 *     le rendre disponible pendant un paiement ferait vendre la pièce deux
 *     fois ;
 *  3. sans visuel stocké, on ne publie pas — même si l'application demande
 *     `AVAILABLE`. La fiche attend son travail d'images.
 */
function nextStatus({
  current,
  wantsArchived,
  hasStoredImages,
}: {
  current: string
  wantsArchived: boolean
  hasStoredImages: boolean
}): 'DRAFT' | 'AVAILABLE' | 'ARCHIVED' | 'RESERVED' | 'SCHEDULED' {
  if (wantsArchived) return 'ARCHIVED'
  if (current === 'RESERVED') return 'RESERVED'
  if (current === 'SCHEDULED') return 'SCHEDULED'
  return hasStoredImages ? 'AVAILABLE' : 'DRAFT'
}

// ---------------------------------------------------------------------------
// Publication, prononcée par le travail d'images
// ---------------------------------------------------------------------------

/**
 * Publie une fiche restée en brouillon faute de visuels.
 *
 * Appelée par le travail d'images, DANS la transaction qui écrit les images :
 * publier une fiche dont les visuels ne seraient pas encore engagés
 * l'exposerait vide pendant un instant.
 *
 * Ne publie QUE ce qui attendait ses images — `DRAFT` sans date de mise en
 * ligne. Une pièce archivée entre-temps par l'application reste archivée ; une
 * pièce déjà publiée n'est pas republiée, et sa date de mise en ligne ne bouge
 * pas.
 */
export async function publishIfPending(
  tx: Prisma.TransactionClient,
  articleId: string,
  offersOpenAfterDays: number,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "Article"
    SET "status" = 'AVAILABLE',
        "publishedAt" = now(),
        "offersOpenAt" = now() + make_interval(days => ${offersOpenAfterDays}::int),
        "updatedAt" = now()
    WHERE "id" = ${articleId}
      AND "status" = 'DRAFT'
      AND "publishedAt" IS NULL
  `

  return updated > 0
}
