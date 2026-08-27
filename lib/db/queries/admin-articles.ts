import 'server-only'

import type { ArticleStatus } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { routing } from '@/lib/i18n/routing'

/**
 * Le catalogue vu depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Ces requêtes rendent DÉLIBÉRÉMENT le coût d'achat et le prix plancher
 * ---------------------------------------------------------------------------
 * Le cahier des charges interdit que `costCents`, `floorPriceCents`,
 * `internalNotes` et `sourcedFrom` sortent dans une réponse PUBLIQUE. Ici,
 * c'est l'inverse : ce sont les données de l'entreprise, rendues à
 * l'entreprise, et l'écran des offres tient déjà la même position pour la même
 * raison — sans le coût, la boutiquière ne peut pas décider.
 *
 * Corriger un coût d'achat demande d'ailleurs de le VOIR, prérempli. L'exiger
 * de mémoire à chaque enregistrement, c'est garantir qu'un jour il sera retapé
 * de travers — et un coût faux déplace le prix plancher, donc le point où une
 * négociation cesse d'être rentable.
 *
 * La garantie qui compte n'est donc pas « ces champs n'existent pas ici », mais
 * « ils n'apparaissent nulle part ailleurs ». C'est ce que vérifient les
 * sélecteurs publics et un test de bout en bout sur le HTML de la fiche.
 *
 * ---------------------------------------------------------------------------
 * Seules les pièces NÉES ICI sont listées
 * ---------------------------------------------------------------------------
 * `externalId IS NULL`. Les pièces importées appartiennent au partenaire : les
 * proposer à la modification laisserait croire qu'on peut les corriger, alors
 * que le prochain import écraserait le travail sans un mot.
 */

const OWN_ARTICLES = { externalId: null } as const

export interface AdminArticleRow {
  id: string
  sku: string
  slug: string
  title: string
  status: ArticleStatus
  priceCents: number
  costCents: number
  floorPriceCents: number
  imageCount: number
  /** Vignette, ou `null` si la pièce n'a pas encore de photo. */
  thumbnailUrl: string | null
  publishedAt: Date | null
  updatedAt: Date
  /** La réservation court-elle encore ? Décidé serveur, pas à l'écran. */
  lockLive: boolean
}

/**
 * La liste des pièces, la plus récemment touchée en tête.
 *
 * Triée par `updatedAt` et non par date de création : ce qu'on cherche en
 * arrivant, c'est la pièce sur laquelle on travaillait.
 */
export async function listOwnArticles(
  locale: string,
  now = new Date(),
  limit = 200,
): Promise<AdminArticleRow[]> {
  const rows = await prisma.article.findMany({
    where: OWN_ARTICLES,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      sku: true,
      slug: true,
      status: true,
      priceCents: true,
      costCents: true,
      floorPriceCents: true,
      publishedAt: true,
      updatedAt: true,
      reservedUntil: true,
      _count: { select: { images: true } },
      images: {
        orderBy: { position: 'asc' },
        take: 1,
        select: { url: true },
      },
      translations: {
        // La locale de l'administration, avec repli sur la langue source : une
        // pièce dont la traduction demandée manquerait sortirait de la liste
        // avec un INNER JOIN, et deviendrait introuvable depuis la régie.
        where: { locale: { in: [locale, routing.defaultLocale] } },
        select: { locale: true, title: true },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    title:
      row.translations.find((t) => t.locale === locale)?.title ??
      row.translations[0]?.title ??
      row.sku,
    status: row.status,
    priceCents: row.priceCents,
    costCents: row.costCents,
    floorPriceCents: row.floorPriceCents,
    imageCount: row._count.images,
    thumbnailUrl: row.images[0]?.url ?? null,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    lockLive: row.reservedUntil !== null && row.reservedUntil > now,
  }))
}

export interface AdminArticleDetail extends AdminArticleRow {
  categoryId: string
  brandName: string | null
  condition: string
  sizeLabel: string
  color: string | null
  material: string | null
  fit: string | null
  description: string
  descriptionIsGenerated: boolean
  weightGrams: number
  allowOffers: boolean
  autoDropEnabled: boolean
  sourcedFrom: string | null
  internalNotes: string | null
  comparePriceCents: number | null
  measurements: { key: string; valueCm: number }[]
  images: { id: string; url: string; position: number }[]
  /** Une commande non payée porte-t-elle cette pièce ? */
  awaitingPayment: boolean
}

/** Une pièce, telle que le formulaire de modification la relit. */
export async function getOwnArticle(
  articleId: string,
  now = new Date(),
): Promise<AdminArticleDetail | null> {
  const row = await prisma.article.findFirst({
    where: { id: articleId, ...OWN_ARTICLES },
    select: {
      id: true,
      sku: true,
      slug: true,
      status: true,
      categoryId: true,
      condition: true,
      sizeLabel: true,
      color: true,
      material: true,
      fit: true,
      priceCents: true,
      comparePriceCents: true,
      costCents: true,
      floorPriceCents: true,
      weightGrams: true,
      allowOffers: true,
      autoDropEnabled: true,
      descriptionIsGenerated: true,
      sourcedFrom: true,
      internalNotes: true,
      publishedAt: true,
      updatedAt: true,
      reservedUntil: true,
      brand: { select: { name: true } },
      _count: { select: { images: true } },
      images: {
        orderBy: { position: 'asc' },
        select: { id: true, url: true, position: true },
      },
      measurements: { select: { key: true, valueCm: true } },
      translations: {
        where: { locale: routing.defaultLocale },
        select: { title: true, description: true },
      },
    },
  })

  if (!row) return null

  const source = row.translations[0]

  const awaitingPayment =
    (await prisma.orderItem.count({
      where: { articleId, order: { status: 'PENDING_PAYMENT' } },
    })) > 0

  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    title: source?.title ?? row.sku,
    // Une description COMPOSÉE n'est pas rendue au formulaire : la reprendre
    // telle quelle la transformerait en texte rédigé au premier enregistrement,
    // et la fiche cesserait de dire qu'elle a été établie automatiquement.
    description: row.descriptionIsGenerated ? '' : (source?.description ?? ''),
    descriptionIsGenerated: row.descriptionIsGenerated,
    status: row.status,
    categoryId: row.categoryId,
    brandName: row.brand?.name ?? null,
    condition: row.condition,
    sizeLabel: row.sizeLabel,
    color: row.color,
    material: row.material,
    fit: row.fit,
    priceCents: row.priceCents,
    comparePriceCents: row.comparePriceCents,
    costCents: row.costCents,
    floorPriceCents: row.floorPriceCents,
    weightGrams: row.weightGrams,
    allowOffers: row.allowOffers,
    autoDropEnabled: row.autoDropEnabled,
    sourcedFrom: row.sourcedFrom,
    internalNotes: row.internalNotes,
    imageCount: row._count.images,
    thumbnailUrl: row.images[0]?.url ?? null,
    images: row.images,
    measurements: row.measurements,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    lockLive: row.reservedUntil !== null && row.reservedUntil > now,
    awaitingPayment,
  }
}

/**
 * Les catégories où une pièce peut se ranger.
 *
 * ---------------------------------------------------------------------------
 * Toutes les feuilles, y compris VIDES
 * ---------------------------------------------------------------------------
 * Les deux requêtes de catalogue existantes ne conviennent ni l'une ni l'autre :
 * l'arbre public ne dit pas quelles catégories sont des feuilles, et la liste à
 * compteurs écarte celles dont l'article count est nul.
 *
 * Or c'est précisément la catégorie encore vide que la boutiquière cherche —
 * celle où elle range sa PREMIÈRE pièce. La filtrer rendrait le formulaire de
 * création inutilisable le jour de l'ouverture.
 */
export async function listLeafCategories(
  locale: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.category.findMany({
    orderBy: { position: 'asc' },
    select: {
      id: true,
      slug: true,
      _count: { select: { children: true } },
      translations: {
        where: { locale: { in: [locale, routing.defaultLocale] } },
        select: { locale: true, name: true },
      },
    },
  })

  return rows
    .filter((row) => row._count.children === 0)
    .map((row) => ({
      id: row.id,
      name:
        row.translations.find((t) => t.locale === locale)?.name ??
        row.translations[0]?.name ??
        row.slug,
    }))
}

/** Combien de pièces attendent d'être mises en vente. */
export async function countDraftArticles(): Promise<number> {
  return prisma.article.count({ where: { ...OWN_ARTICLES, status: 'DRAFT' } })
}
