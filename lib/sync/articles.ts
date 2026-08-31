import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { SITE } from '@/lib/config/site'
import {
  getPricingConfig,
  getSettings,
  type SettingKey,
} from '@/lib/config/settings'
import {
  computeFloorPriceCents,
  computeNetMarginCents,
  type PricingConfig,
} from '@/lib/domain/pricing'
import { routing } from '@/lib/i18n/routing'
import { enqueue } from '@/lib/jobs/queue'
import {
  detailForIssue,
  reasonForIssue,
  syncArticleSchema,
  type SyncArticleInput,
  type SyncRejectionReason,
} from '@/lib/validation/sync'
import { allocateInventoryNumber, buildArticleSlug } from './identifiers'
import {
  resolveBrandId,
  writeTranslations,
  writeMeasurements,
} from '@/lib/articles/write'

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
 * réponse qui n'arriverait jamais. Une pièce qui ANNONCE des visuels est donc
 * créée en brouillon, un travail est inscrit, et la fiche se publie seule quand
 * ils sont stockés.
 *
 * Une pièce qui n'en annonce AUCUN est publiée tout de suite. Ce n'était pas le
 * cas jusqu'ici : la publication étant déléguée au travail d'images, un lot sans
 * photos était accepté, répondait « créé », et restait invisible pour toujours.
 * L'inventaire qui alimente la boutique n'ayant pas de photos à envoyer, c'est
 * la totalité du stock qui tombait dans ce trou.
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
  /**
   * Poids de repli quand l'inventaire n'en envoie pas, en grammes.
   *
   * La colonne est semée avec le catalogue depuis le début — un t-shirt à 200 g,
   * un manteau à 1 500 g — et n'était lue nulle part : son commentaire de schéma
   * promettait de « pré-remplir Article.weightGrams » sans que rien ne le fasse.
   * C'est elle qui rend le poids facultatif dans le contrat.
   *
   * `null` sur une catégorie parente, et sur toute feuille dont personne n'a
   * renseigné la grille. Dans ce cas la pièce est refusée, jamais devinée.
   */
  defaultWeightGrams: number | null
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

/**
 * Les réglages que l'import exige, en plus de ceux du calcul de prix.
 *
 * Exportés pour la même raison que `PRICING_SETTING_KEYS` : un test vérifie que
 * chacun est renseignable depuis le back-office. `floorShippingZoneCode` ne
 * l'était pas, et c'est précisément lui qui a bloqué le premier import réel —
 * obligatoire pour vendre, absent de tout formulaire.
 */
export const SYNC_SETTING_KEYS = [
  'packagingWeightGrams',
  'offersOpenAfterDays',
  'floorShippingZoneCode',
] as const satisfies readonly SettingKey[]

export async function loadSyncContext(): Promise<SyncContext> {
  const [pricing, settings] = await Promise.all([
    getPricingConfig(),
    getSettings(SYNC_SETTING_KEYS),
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
        defaultWeightGrams: true,
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
      defaultWeightGrams: row.defaultWeightGrams,
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
  // Le poids envoyé l'emporte toujours : c'est une pesée, la grille n'est qu'une
  // moyenne de famille. À défaut, on retombe sur `Category.defaultWeightGrams`.
  //
  // Et si la catégorie n'en a pas non plus, on REFUSE. La tentation serait de
  // prendre un poids moyen tous vêtements confondus — un chiffre qui n'existe
  // pas. Il servirait à choisir le palier transporteur, donc le port facturé et
  // le prix plancher : une écharpe payée au tarif d'un manteau, ou l'inverse, à
  // chaque colis, sans que rien ne le signale.
  const weightGrams = input.weightGrams ?? category.defaultWeightGrams
  if (weightGrams === null) {
    return rejected(
      input.externalId,
      'missing-weight',
      `aucun poids envoyé et la catégorie « ${category.slug} » n’a pas de poids par défaut`,
    )
  }

  // Le palier s'applique au COLIS, emballage compris. Vérifier le poids de la
  // pièce seule laisserait passer une pièce de 4 980 g qui, une fois emballée,
  // ne trouverait aucun tarif — et le refus tomberait à l'étape du paiement,
  // devant l'acheteuse, au lieu de tomber ici.
  const parcelWeightGrams = weightGrams + context.packagingWeightGrams
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
  //
  // La simulation doit annoncer ce que l'écriture ferait VRAIMENT, sinon elle
  // ne sert à rien : c'est sur son rapport qu'on décide de lancer un import de
  // plusieurs centaines de pièces. Elle rejoue donc `nextStatus`, la même
  // fonction que l'écriture, plutôt que de recopier une approximation.
  if (options.dryRun) {
    const awaitsImages = input.images.length > 0

    return existing
      ? {
          externalId: input.externalId,
          action: 'would-update',
          sku: existing.sku,
          slug: existing.slug,
          url: publicUrlFor(existing.slug),
          ...economics,
          imagesPending:
            awaitsImages && imagesChanged(existing.images, input.images),
          published:
            nextStatus({
              current: existing.status,
              wantsArchived,
              hasStoredImages: existing.images.length > 0,
              awaitsImages,
            }) === 'AVAILABLE',
        }
      : {
          externalId: input.externalId,
          action: 'would-create',
          // Ni `sku` ni `slug` : ils n'existent pas, et un essai à blanc n'en
          // consomme pas. En inventer un ici serait pire qu'une absence — il
          // ne serait pas celui attribué à l'écriture réelle.
          ...economics,
          imagesPending: awaitsImages,
          published: !wantsArchived && !awaitsImages,
        }
  }

  // ---- Écriture ----------------------------------------------------------
  return existing
    ? updateArticle(input, existing, category, economics, weightGrams, context)
    : createArticle(input, category, economics, weightGrams, context)
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

/**
 * `weightGrams` est passé À PART, jamais relu depuis `input`.
 *
 * C'est le seul champ du contrat dont la valeur écrite peut ne pas être celle
 * reçue : elle vient de la catégorie quand l'inventaire n'en envoie pas. Le lire
 * ici depuis `input` réécrirait `null` en base sur une pièce dont le poids avait
 * bien été résolu — et le port cesserait d'être calculable.
 */
function attributeFields(
  input: SyncArticleInput,
  categoryId: string,
  weightGrams: number,
) {
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
    weightGrams,
    externalSyncedAt: new Date(),
  }
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

async function createArticle(
  input: SyncArticleInput,
  category: CategoryEntry,
  economics: Economics,
  weightGrams: number,
  context: SyncContext,
): Promise<SyncResult> {
  // Attend-elle des visuels ? C'est la question qui décide de tout ici.
  //
  // Quand elle en attend, la publication est prononcée par le travail d'images,
  // dans la transaction qui les écrit : la fiche ne s'expose jamais vide.
  //
  // Quand elle n'en attend AUCUN, ce travail ne s'inscrit pas — et déléguer la
  // publication à un travail inexistant laissait la pièce en brouillon pour
  // toujours. C'est exactement ce qui se passait : un lot sans photos était
  // accepté, répondait « créé », et rien n'apparaissait jamais au catalogue.
  const awaitsImages = input.images.length > 0

  const status =
    input.status === 'ARCHIVED' ? 'ARCHIVED' : awaitsImages ? 'DRAFT' : 'AVAILABLE'
  const publishesNow = status === 'AVAILABLE'
  const now = new Date()

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
        ...attributeFields(input, category.id, weightGrams),
        floorPriceCents: economics.floorPriceCents,
        descriptionIsGenerated: input.description === undefined,
        // Une pièce envoyée déjà archivée naît archivée, quoi qu'il arrive : le
        // travail d'images ne publie que ce qui est en brouillon.
        status,
        // `publishedAt` conditionne TOUTE la visibilité — `lib/db/visibility.ts`
        // l'exige non nulle, et le verrou de stock aussi. Une pièce AVAILABLE
        // sans cette date serait « en vente » et pourtant introuvable au
        // catalogue, en 404 sur sa fiche, et impossible à mettre au panier.
        ...(publishesNow
          ? {
              publishedAt: now,
              offersOpenAt: new Date(
                now.getTime() + context.offersOpenAfterDays * 24 * 60 * 60_000,
              ),
            }
          : {}),
      },
      select: { id: true },
    })

    await writeTranslations(tx, article.id, input, category, brand?.name ?? null)
    await writeMeasurements(tx, article.id, input.measurements)

    // Pas de travail vide : inscrire un téléchargement sans aucune URL ferait
    // tourner le worker pour rien, et sa trace laisserait croire que des
    // visuels sont en route.
    if (awaitsImages) {
      await enqueue(tx, {
        type: 'article.images',
        payload: { articleId: article.id, urls: [...input.images] },
      })
    }

    return {
      externalId: input.externalId,
      action: 'created' as const,
      sku,
      slug,
      url: publicUrlFor(slug),
      ...economics,
      imagesPending: awaitsImages,
      published: publishesNow,
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
  weightGrams: number,
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

    /**
     * Un tableau d'images VIDE ne veut pas dire « supprime-les ».
     *
     * Il veut dire « je n'ai rien à dire des visuels ». La distinction est
     * vitale ici : l'inventaire qui alimente la boutique ne stocke aucune photo
     * et enverra donc TOUJOURS un tableau vide. Traité comme une consigne de
     * remplacement, chaque passage de synchronisation effacerait les clichés
     * que la boutiquière vient d'ajouter depuis la régie — et le catalogue se
     * reviderait tout seul, toutes les nuits, sans erreur nulle part.
     *
     * Retirer une photo reste possible : depuis la régie, qui est le seul
     * endroit d'où l'on en met.
     */
    const awaitsImages = input.images.length > 0
    const needsImages = awaitsImages && imagesChanged(existing.images, input.images)
    const hasStoredImages = existing.images.length > 0

    const status = nextStatus({
      current: existing.status,
      wantsArchived: input.status === 'ARCHIVED',
      hasStoredImages,
      awaitsImages,
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
        ...attributeFields(input, category.id, weightGrams),
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
    await writeMeasurements(tx, existing.id, input.measurements)

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
 *  3. on ne publie pas une fiche qui ATTEND des visuels et ne les a pas encore
 *     — elle s'afficherait vide le temps du téléchargement. Une fiche qui n'en
 *     attend aucun, elle, se publie : c'est le cas de tout l'inventaire, qui
 *     n'a pas de photos à envoyer.
 */
function nextStatus({
  current,
  wantsArchived,
  hasStoredImages,
  awaitsImages,
}: {
  current: string
  wantsArchived: boolean
  hasStoredImages: boolean
  awaitsImages: boolean
}): 'DRAFT' | 'AVAILABLE' | 'ARCHIVED' | 'RESERVED' | 'SCHEDULED' {
  if (wantsArchived) return 'ARCHIVED'
  if (current === 'RESERVED') return 'RESERVED'
  if (current === 'SCHEDULED') return 'SCHEDULED'

  // Le brouillon ne subsiste que pendant l'attente d'un visuel demandé.
  return hasStoredImages || !awaitsImages ? 'AVAILABLE' : 'DRAFT'
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
