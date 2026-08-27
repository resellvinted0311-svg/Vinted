import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { getPricingConfig, getSettings } from '@/lib/config/settings'
import {
  allocateInventoryNumber,
  buildArticleSlug,
  slugify,
} from '@/lib/sync/identifiers'
import { voidOffersForArticles } from '@/lib/shop/offers'
import {
  planListing,
  type ListingAction,
  type ListingRefusal,
} from '@/lib/domain/article-listing'
import {
  computeArticleEconomics,
  type ArticleEconomicsContext,
} from './economics'
import {
  canonicalBrandName,
  resolveBrandId,
  writeTranslations,
  writeMeasurements,
  type ArticleContentInput,
  type CategoryForWrite,
} from './write'

/**
 * Écrire une pièce depuis le back-office.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module fait et que la synchronisation ne fait pas
 * ---------------------------------------------------------------------------
 * Une pièce née ici garde `externalId` NUL, et ce n'est pas un détail : les
 * pièces qui en portent un entrent dans le flux du partenaire, où un import
 * ultérieur portant le même identifiant écraserait sans bruit une fiche saisie
 * à la main. La colonne est la frontière entre les deux mondes, et toutes les
 * écritures d'ici la vérifient.
 *
 * ---------------------------------------------------------------------------
 * Toute modification est un UPDATE CONDITIONNEL
 * ---------------------------------------------------------------------------
 * Un formulaire est rendu à un instant et enregistré à un autre. Entre les
 * deux, trois choses peuvent avoir touché la pièce : une cliente l'a réservée
 * au panier, l'encaissement l'a marquée vendue, ou le balayage périodique en a
 * baissé le prix.
 *
 * Un `update({ where: { id } })` précédé d'une lecture ne protège de rien : la
 * fenêtre entre les deux appartient à qui la lit. On compare donc `updatedAt`
 * dans la clause elle-même, et zéro ligne modifiée est un REFUS, pas un
 * succès silencieux.
 */

// ---------------------------------------------------------------------------
// Contexte
// ---------------------------------------------------------------------------

export interface ArticleWriteContext extends ArticleEconomicsContext {
  category: CategoryForWrite & { id: string; isLeaf: boolean }
  offersOpenAfterDays: number
}

export type ContextResult =
  | { ok: true; context: ArticleWriteContext }
  | { ok: false; reason: 'unknown-category' | 'category-not-leaf' }

/**
 * Charge ce qu'il faut pour écrire UNE pièce.
 *
 * La synchronisation charge tout l'arbre des catégories avec ses huit
 * traductions : le coût est amorti sur un lot de cent. Pour un formulaire, ce
 * serait gaspillé — on ne lit que la catégorie choisie.
 */
export async function loadArticleWriteContext(
  categoryId: string,
): Promise<ContextResult> {
  const [pricing, settings, category] = await Promise.all([
    getPricingConfig(),
    getSettings([
      'packagingWeightGrams',
      'offersOpenAfterDays',
      'floorShippingZoneCode',
    ]),
    prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        slug: true,
        _count: { select: { children: true } },
        translations: { select: { locale: true, name: true } },
      },
    }),
  ])

  if (!category) return { ok: false, reason: 'unknown-category' }

  // Une pièce se range dans une FEUILLE. Rattachée à un rayon intermédiaire,
  // elle n'apparaîtrait dans aucune de ses sous-catégories — invisible là où on
  // la cherche, visible là où personne ne regarde.
  if (category._count.children > 0) {
    return { ok: false, reason: 'category-not-leaf' }
  }

  const rates = await prisma.shippingRate.findMany({
    where: { active: true, zone: { code: settings.floorShippingZoneCode } },
    orderBy: { maxWeightGrams: 'asc' },
    select: { maxWeightGrams: true, priceCents: true },
  })

  return {
    ok: true,
    context: {
      pricing,
      packagingWeightGrams: settings.packagingWeightGrams,
      offersOpenAfterDays: settings.offersOpenAfterDays,
      rates,
      category: {
        id: category.id,
        slug: category.slug,
        isLeaf: true,
        nameByLocale: new Map(category.translations.map((t) => [t.locale, t.name])),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export interface ArticleWriteInput extends ArticleContentInput {
  categoryId: string
  brandName?: string | undefined
  priceCents: number
  costCents: number
  weightGrams: number
  allowOffers: boolean
  autoDropEnabled: boolean
  sourcedFrom?: string | undefined
  internalNotes?: string | undefined
}

export type WriteRefusal =
  | 'unknown-category'
  | 'category-not-leaf'
  | 'weight-not-covered'
  | 'price-below-floor'
  | 'not-found'
  | 'not-editable'
  | 'modified-meanwhile'

export type WriteResult =
  | { ok: true; articleId: string; slug: string; floorPriceCents: number }
  | { ok: false; reason: WriteRefusal }

/** Les champs d'attribut communs à la création et à la modification. */
function attributeFields(input: ArticleWriteInput, categoryId: string) {
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
    costCents: input.costCents,
    weightGrams: input.weightGrams,
    allowOffers: input.allowOffers,
    autoDropEnabled: input.autoDropEnabled,
    sourcedFrom: input.sourcedFrom ?? null,
    internalNotes: input.internalNotes ?? null,
    descriptionIsGenerated: input.description === undefined,
  }
}

export async function createShopArticle(
  input: ArticleWriteInput,
): Promise<WriteResult> {
  const loaded = await loadArticleWriteContext(input.categoryId)
  if (!loaded.ok) return { ok: false, reason: loaded.reason }

  const { context } = loaded

  const economics = computeArticleEconomics(input, context)
  if (!economics.ok) return { ok: false, reason: 'weight-not-covered' }

  if (input.priceCents < economics.floorPriceCents) {
    return { ok: false, reason: 'price-below-floor' }
  }

  // Le nom canonique est lu HORS transaction pour composer les descriptions
  // avec la forme qui sera affichée. Sans cela, une boutiquière qui tape
  // « ralph lauren » obtiendrait huit relevés portant cette graphie sous un
  // bloc marque affichant « Ralph Lauren », et le vecteur de recherche
  // indexerait la forme fautive.
  const displayBrand = await canonicalBrandName(prisma, input.brandName)

  return prisma.$transaction(async (tx) => {
    const brandId = await resolveBrandId(tx, input.brandName)

    // Le numéro d'inventaire est attribué DANS la transaction : appelé dehors,
    // une validation qui échoue plus loin consommerait un numéro pour rien et
    // le compteur deviendrait troué.
    const { sequence, sku } = await allocateInventoryNumber(tx)

    const brandSlugSource = displayBrand ?? undefined

    const article = await tx.article.create({
      data: {
        sku,
        slug: buildArticleSlug({
          categorySlug: context.category.slug,
          brandSlug: brandSlugSource === undefined ? null : slugify(brandSlugSource),
          sizeLabel: input.sizeLabel,
          sequence,
        }),
        brandId,
        ...attributeFields(input, context.category.id),
        floorPriceCents: economics.floorPriceCents,
        // Née en brouillon, TOUJOURS : une pièce n'a pas encore de photo à cet
        // instant, et publier sans visuel produirait une vignette vide au
        // catalogue. La mise en vente est un second geste, explicite.
        status: 'DRAFT',
        // `externalId` reste nul : voir l'en-tête du module.
      },
      select: { id: true, slug: true },
    })

    await writeTranslations(tx, article.id, input, context.category, displayBrand)
    await writeMeasurements(tx, article.id, input.measurements)

    return {
      ok: true as const,
      articleId: article.id,
      slug: article.slug,
      floorPriceCents: economics.floorPriceCents,
    }
  })
}

export async function updateShopArticle(
  articleId: string,
  input: ArticleWriteInput,
  expectedUpdatedAt: Date,
  now = new Date(),
): Promise<WriteResult> {
  const loaded = await loadArticleWriteContext(input.categoryId)
  if (!loaded.ok) return { ok: false, reason: loaded.reason }

  const { context } = loaded

  const economics = computeArticleEconomics(input, context)
  if (!economics.ok) return { ok: false, reason: 'weight-not-covered' }

  if (input.priceCents < economics.floorPriceCents) {
    return { ok: false, reason: 'price-below-floor' }
  }

  const existing = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      externalId: true,
      status: true,
      reservedUntil: true,
      comparePriceCents: true,
    },
  })

  if (!existing || existing.externalId !== null) {
    return { ok: false, reason: 'not-found' }
  }

  const lockLive =
    existing.reservedUntil !== null && existing.reservedUntil > now
  if (lockLive || !['DRAFT', 'AVAILABLE', 'ARCHIVED'].includes(existing.status)) {
    return { ok: false, reason: 'not-editable' }
  }

  const displayBrand = await canonicalBrandName(prisma, input.brandName)

  return prisma.$transaction(async (tx) => {
    const brandId = await resolveBrandId(tx, input.brandName)

    // ---------------------------------------------------------------------
    // Le prix barré n'est PAS réécrit ici
    // ---------------------------------------------------------------------
    // `comparePriceCents` appartient au balayage de baisse automatique, qui y
    // inscrit le prix d'ORIGINE et s'en sert comme base du palier suivant.
    // L'effacer à chaque enregistrement — ce que ferait un champ absent du
    // formulaire remis à null — ferait retomber cette base sur le prix DÉJÀ
    // baissé, et les remises se composeraient : la pièce descendrait palier
    // après palier jusqu'au plancher, et le prix barré disparaîtrait de la
    // vitrine au premier enregistrement.
    //
    // Une seule exception, et elle est honnête : si le nouveau prix rattrape ou
    // dépasse le barré, la remise n'existe plus. Laisser le barré afficherait
    // une réduction qui n'en est pas une.
    const clearsCompare =
      existing.comparePriceCents !== null &&
      input.priceCents >= existing.comparePriceCents

    const updated = await tx.article.updateMany({
      where: {
        id: articleId,
        // La frontière avec le monde du partenaire, revérifiée dans la clause.
        externalId: null,
        status: { in: ['DRAFT', 'AVAILABLE', 'ARCHIVED'] },
        // Le cœur de la protection : la pièce n'a pas bougé depuis le rendu du
        // formulaire.
        updatedAt: expectedUpdatedAt,
      },
      data: {
        brandId,
        ...attributeFields(input, context.category.id),
        floorPriceCents: economics.floorPriceCents,
        ...(clearsCompare ? { comparePriceCents: null } : {}),
      },
    })

    if (updated.count === 0) {
      return { ok: false as const, reason: 'modified-meanwhile' as const }
    }

    await writeTranslations(tx, articleId, input, context.category, displayBrand)
    await writeMeasurements(tx, articleId, input.measurements)

    const after = await tx.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { slug: true },
    })

    return {
      ok: true as const,
      articleId,
      slug: after.slug,
      floorPriceCents: economics.floorPriceCents,
    }
  })
}

// ---------------------------------------------------------------------------
// Mise en vente et retrait
// ---------------------------------------------------------------------------

export type ListingResult =
  | { ok: true; status: 'AVAILABLE' | 'ARCHIVED'; voidedOffers: number }
  | { ok: false; reason: ListingRefusal | 'not-found' | 'modified-meanwhile' }

/**
 * Applique un geste de mise en vente.
 *
 * ---------------------------------------------------------------------------
 * L'extinction des offres vient APRÈS l'UPDATE, dans la même transaction
 * ---------------------------------------------------------------------------
 * L'ordre inverse aurait un défaut sans retour : si l'UPDATE conditionnel sort
 * à zéro ligne — quelqu'un vient de réserver la pièce à la milliseconde près —
 * les offres auraient déjà été éteintes sur une pièce restée en vente. Or une
 * offre ACCEPTÉE détruite ne se rétablit pas : aucun chemin du dépôt ne la
 * réveille, et l'acheteuse perdrait le prix qu'on venait de lui accorder sans
 * que personne l'apprenne.
 */
export async function applyListing(
  articleId: string,
  action: ListingAction,
  now = new Date(),
): Promise<ListingResult> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      externalId: true,
      status: true,
      publishedAt: true,
      reservedUntil: true,
      updatedAt: true,
      _count: { select: { images: true } },
    },
  })

  if (!article || article.externalId !== null) {
    return { ok: false, reason: 'not-found' }
  }

  // Une commande non payée qui porte cette pièce interdit le retrait : voir
  // `lib/domain/article-listing.ts`, c'est le refus qui évite l'encaissement
  // d'une vente qu'on ne pourra plus honorer.
  const awaitingPayment =
    (await prisma.orderItem.count({
      where: { articleId, order: { status: 'PENDING_PAYMENT' } },
    })) > 0

  const plan = planListing(action, {
    status: article.status,
    hasImage: article._count.images > 0,
    lockLive: article.reservedUntil !== null && article.reservedUntil > now,
    awaitingPayment,
  })

  if (!plan.ok) return { ok: false, reason: plan.reason }

  return prisma.$transaction(async (tx) => {
    const changed = await tx.article.updateMany({
      where: {
        id: articleId,
        externalId: null,
        status: article.status,
        updatedAt: article.updatedAt,
      },
      data: {
        status: plan.to,
        ...(plan.setPublishedAt && article.publishedAt === null
          ? { publishedAt: now }
          : {}),
        ...(plan.clearReservation
          ? { reservedById: null, reservedUntil: null }
          : {}),
      },
    })

    if (changed.count === 0) {
      return { ok: false as const, reason: 'modified-meanwhile' as const }
    }

    // Retirer une pièce éteint les négociations en cours : laisser vivre une
    // offre sur une pièce qu'on ne vend plus promettrait un prix sur quelque
    // chose d'inachetable.
    const voidedOffers =
      plan.to === 'ARCHIVED'
        ? await voidOffersForArticles(tx, [articleId], now, 'ARTICLE_WITHDRAWN')
        : 0

    return { ok: true as const, status: plan.to as 'AVAILABLE' | 'ARCHIVED', voidedOffers }
  })
}

/** Le client de lecture accepté par les aides ci-dessus. */
export type Reader = Prisma.TransactionClient | typeof prisma
