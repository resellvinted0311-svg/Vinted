import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { locales } from '@/lib/i18n/routing'
import {
  loadSyncContext,
  publishIfPending,
  syncArticle,
  type SyncContext,
} from '@/lib/sync/articles'

/**
 * L'import d'inventaire, contre une vraie base.
 *
 * Ce qui compte ici n'est pas que le schéma valide — `tests/domain` s'en
 * charge — mais que l'écriture fasse ce qu'elle promet : un second envoi met à
 * jour au lieu de dupliquer, l'adresse publique ne bouge plus, rien n'est
 * publié sans visuel, et une pièce en cours de paiement ne se laisse pas
 * archiver sous les doigts de son acheteuse.
 */

const PREFIX = 'sync-test-'
const BRAND = 'Marque Essai Sync'

const BASE = {
  externalId: `${PREFIX}1`,
  title: 'Chemise en coton rayée',
  categorySlug: 'chemises',
  condition: 'VERY_GOOD',
  sizeLabel: 'L',
  priceCents: 3800,
  costCents: 900,
  weightGrams: 320,
  images: ['https://images.exemple.fr/a.jpg', 'https://images.exemple.fr/b.jpg'],
} as const

function payload(patch: Record<string, unknown> = {}) {
  return { ...BASE, ...patch }
}

let context: SyncContext

async function cleanup(): Promise<void> {
  const articles = await prisma.article.findMany({
    where: { externalId: { startsWith: PREFIX } },
    select: { id: true },
  })
  const ids = articles.map((article) => article.id)

  if (ids.length > 0) {
    // Traductions, images et mesures partent en cascade ; les travaux
    // inscrits, non — ils ne référencent l'article que par leur charge utile.
    await prisma.article.deleteMany({ where: { id: { in: ids } } })
  }

  await prisma.job.deleteMany({ where: { type: 'article.images' } })
  await prisma.brand.deleteMany({ where: { name: BRAND } })
}

beforeEach(async () => {
  await cleanup()
  context = await loadSyncContext()
})

afterAll(cleanup)

/** Raccourci : synchronise une pièce et renvoie le résultat. */
function sync(patch: Record<string, unknown> = {}, dryRun = false) {
  return syncArticle(payload(patch), 0, context, { dryRun })
}

/**
 * Simule ce que le travail d'images aurait écrit.
 *
 * Le travail lui-même sort sur le réseau ; ce fichier teste l'import, pas le
 * téléchargement. Ce qui compte ici est l'ÉTAT qu'il laisse derrière lui —
 * `sourceUrl` renseigné — parce que c'est cet état que la synchronisation
 * suivante interroge.
 */
async function storeImages(sourceUrls: readonly string[]): Promise<void> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { externalId: BASE.externalId },
    select: { id: true },
  })

  await prisma.articleImage.deleteMany({ where: { articleId: article.id } })

  for (const [position, sourceUrl] of sourceUrls.entries()) {
    await prisma.articleImage.create({
      data: {
        articleId: article.id,
        url: `https://res.cloudinary.test/${position}.webp`,
        sourceUrl,
        width: 1200,
        height: 1600,
        position,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

describe('création', () => {
  it('crée une pièce en brouillon, avec numéro, adresse et travail d’images', async () => {
    const result = await sync()

    expect(result.action).toBe('created')
    expect(result.sku).toMatch(/^ART-\d{6}$/)
    expect(result.slug).toBeDefined()
    expect(result.url).toContain(`/a/${result.slug}`)

    const article = await prisma.article.findUnique({
      where: { externalId: BASE.externalId },
      select: { status: true, publishedAt: true, sku: true, slug: true },
    })

    // Aucune fiche publiée sans visuel : c'est la règle du contrat, et elle
    // s'applique à la création sans exception.
    expect(article?.status).toBe('DRAFT')
    expect(article?.publishedAt).toBeNull()
    expect(result.published).toBe(false)
    expect(result.imagesPending).toBe(true)

    const jobs = await prisma.job.findMany({ where: { type: 'article.images' } })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toMatchObject({ urls: [...BASE.images] })
  })

  it('calcule le plancher et dit la marge, même négative', async () => {
    const healthy = await sync()
    expect(healthy.floorPriceCents).toBeGreaterThan(0)
    expect(healthy.belowFloor).toBe(false)
    expect(healthy.estimatedMarginCents).toBeGreaterThan(0)

    await cleanup()
    context = await loadSyncContext()

    // Sous le plancher, la pièce est QUAND MÊME publiée : brader appartient au
    // vendeur. Ce qu'on doit, c'est le chiffre exact.
    const sacrificed = await sync({ priceCents: 500, costCents: 900 })
    expect(sacrificed.action).toBe('created')
    expect(sacrificed.belowFloor).toBe(true)
    expect(sacrificed.estimatedMarginCents).toBeLessThan(0)
  })

  it('écrit les huit traductions, les sept autres marquées comme repli', async () => {
    await sync()

    const translations = await prisma.articleTranslation.findMany({
      where: { article: { externalId: BASE.externalId } },
      select: { locale: true, isFallback: true, isMachineTranslated: true, title: true },
    })

    // Huit lignes, parce que le listing du catalogue joint les traductions en
    // INNER JOIN : une pièce sans ligne `nl` serait ABSENTE du catalogue
    // néerlandais, pas mal traduite.
    expect(translations).toHaveLength(locales.length)

    for (const translation of translations) {
      expect(translation.title).toBe(BASE.title)
      // Rien n'a été traduit par machine : annoncer le contraire serait faux.
      expect(translation.isMachineTranslated).toBe(false)
      expect(translation.isFallback).toBe(translation.locale !== 'fr')
    }
  })

  it('compose une description dans chaque langue à défaut d’en recevoir une', async () => {
    await sync({
      brandName: BRAND,
      color: 'marine',
      material: 'coton',
      fit: 'droite',
      measurements: { chest: 54, length: 72 },
    })

    const article = await prisma.article.findUnique({
      where: { externalId: BASE.externalId },
      select: {
        descriptionIsGenerated: true,
        translations: {
          where: { locale: { in: ['fr', 'en'] } },
          select: { locale: true, description: true },
        },
      },
    })

    expect(article?.descriptionIsGenerated).toBe(true)

    const fr = article?.translations.find((t) => t.locale === 'fr')?.description
    const en = article?.translations.find((t) => t.locale === 'en')?.description

    expect(fr).toContain('Coton')
    expect(fr).toContain('Bleu marine')
    expect(fr).toContain('54 cm')
    // Composée dans CHAQUE langue : le vecteur de recherche anglais contient
    // donc de vrais mots anglais, pas du français recopié.
    expect(en).toContain('Cotton')
    expect(en).toContain('Navy')
    expect(en).not.toBe(fr)
  })

  it('n’invente rien pour les champs absents', async () => {
    await sync()

    const fr = await prisma.articleTranslation.findFirst({
      where: { article: { externalId: BASE.externalId }, locale: 'fr' },
      select: { description: true },
    })

    // Ni tiret, ni « non renseigné », ni supposition : une ligne sans valeur
    // n'est pas écrite du tout.
    expect(fr?.description).not.toContain('—\n')
    expect(fr?.description).not.toMatch(/non renseigné/i)
  })

  it('crée la marque inconnue, puis la réutilise sans tenir compte de la casse', async () => {
    const first = await sync({ brandName: BRAND })
    expect(first.action).toBe('created')

    const second = await syncArticle(
      payload({ externalId: `${PREFIX}2`, brandName: BRAND.toLowerCase() }),
      0,
      context,
      { dryRun: false },
    )
    expect(second.action).toBe('created')

    // Deux fiches marque pour un même nom couperaient le catalogue en deux.
    const brands = await prisma.brand.findMany({ where: { name: BRAND } })
    expect(brands).toHaveLength(1)
  })

  it('enregistre les mesures reçues', async () => {
    await sync({ measurements: { chest: 54, length: 72 } })

    const measurements = await prisma.articleMeasurement.findMany({
      where: { article: { externalId: BASE.externalId } },
      orderBy: { key: 'asc' },
      select: { key: true, valueCm: true },
    })

    expect(measurements).toEqual([
      { key: 'chest', valueCm: 54 },
      { key: 'length', valueCm: 72 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Refus
// ---------------------------------------------------------------------------

describe('refus', () => {
  it('refuse une catégorie inconnue', async () => {
    const result = await sync({ categorySlug: 'chapeaux' })
    expect(result.action).toBe('rejected')
    expect(result.reason).toBe('unknown-category')
  })

  it('refuse une catégorie parente, en le disant', async () => {
    const result = await sync({ categorySlug: 'hauts' })
    expect(result.action).toBe('rejected')
    expect(result.reason).toBe('unknown-category')
    expect(result.detail).toContain('parente')
  })

  it('refuse un poids qu’aucun palier ne couvre, emballage compris', async () => {
    const heaviest = context.floorRates.at(-1)?.maxWeightGrams ?? 0
    expect(heaviest).toBeGreaterThan(0)

    const result = await sync({ weightGrams: heaviest + 1 })

    expect(result.action).toBe('rejected')
    expect(result.reason).toBe('weight-not-covered')
    // Le détail cite l'emballage : sans lui, on chercherait longtemps pourquoi
    // une pièce de 5000 g est refusée alors que le palier annonce 5000 g.
    expect(result.detail).toContain('emballage')
  })

  it('refuse une pièce dont le colis dépasse le palier de peu', async () => {
    const heaviest = context.floorRates.at(-1)?.maxWeightGrams ?? 0

    // Le cas piège : la pièce seule tient dans le palier, le colis non. Vérifier
    // le poids nu laisserait le refus tomber à l'étape du paiement, devant
    // l'acheteuse.
    const justUnder = heaviest - Math.floor(context.packagingWeightGrams / 2)
    const result = await sync({ weightGrams: justUnder })

    expect(result.action).toBe('rejected')
    expect(result.reason).toBe('weight-not-covered')
  })

  it('n’écrit rien quand une pièce est refusée', async () => {
    await sync({ categorySlug: 'hauts' })

    const article = await prisma.article.findUnique({
      where: { externalId: BASE.externalId },
    })
    expect(article).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Essai à blanc
// ---------------------------------------------------------------------------

describe('essai à blanc', () => {
  it('calcule tout et n’écrit rien', async () => {
    const result = await sync({}, true)

    expect(result.action).toBe('would-create')
    expect(result.floorPriceCents).toBeGreaterThan(0)
    expect(result.estimatedMarginCents).toBeDefined()

    // Ni numéro, ni adresse : un essai à blanc n'en consomme pas, et en
    // inventer un serait pire qu'une absence — il ne serait pas celui attribué
    // à l'écriture réelle.
    expect(result.sku).toBeUndefined()
    expect(result.slug).toBeUndefined()

    expect(
      await prisma.article.findUnique({ where: { externalId: BASE.externalId } }),
    ).toBeNull()
    expect(await prisma.job.count({ where: { type: 'article.images' } })).toBe(0)
  })

  it('annonce une mise à jour sur une pièce existante, sans la toucher', async () => {
    const created = await sync()
    const before = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { priceCents: true, updatedAt: true },
    })

    const result = await sync({ priceCents: 9900 }, true)

    expect(result.action).toBe('would-update')
    expect(result.sku).toBe(created.sku)

    const after = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { priceCents: true },
    })
    expect(after.priceCents).toBe(before.priceCents)
  })
})

// ---------------------------------------------------------------------------
// Mise à jour
// ---------------------------------------------------------------------------

describe('mise à jour', () => {
  it('met à jour au lieu de dupliquer, et ne change pas l’adresse publique', async () => {
    const created = await sync()
    const updated = await sync({ priceCents: 2900, title: 'Chemise corrigée' })

    expect(updated.action).toBe('updated')
    // C'est la promesse du contrat : `externalId` fait qu'un second envoi met
    // à jour. Et l'adresse ne bouge pas — un lien partagé continue de marcher.
    expect(updated.sku).toBe(created.sku)
    expect(updated.slug).toBe(created.slug)

    const count = await prisma.article.count({
      where: { externalId: BASE.externalId },
    })
    expect(count).toBe(1)

    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { priceCents: true, translations: { where: { locale: 'fr' } } },
    })
    expect(article.priceCents).toBe(2900)
    expect(article.translations[0]?.title).toBe('Chemise corrigée')
  })

  it('n’inscrit pas de nouveau travail quand les visuels sont déjà stockés', async () => {
    await sync()
    await storeImages(BASE.images)
    await prisma.job.deleteMany({ where: { type: 'article.images' } })

    await sync({ priceCents: 2900 })

    // C'est ce que `ArticleImage.sourceUrl` sert à savoir. Sans lui, une
    // simple correction de prix ferait retélécharger dix images chez un
    // hébergeur qui n'a rien demandé.
    expect(await prisma.job.count({ where: { type: 'article.images' } })).toBe(0)
  })

  it('réinscrit un travail tant que les visuels ne sont PAS stockés', async () => {
    await sync()
    await prisma.job.deleteMany({ where: { type: 'article.images' } })

    await sync({ priceCents: 2900 })

    // Doublon assumé : tant que rien n'est stocké, on ne peut pas distinguer
    // « déjà demandé » de « jamais demandé ». Le second travail court-circuite
    // dès que les visuels du premier sont en place — voir `fetchArticleImages`,
    // qui compare les `sourceUrl` avant de retélécharger quoi que ce soit.
    expect(await prisma.job.count({ where: { type: 'article.images' } })).toBe(1)
  })

  it('inscrit un travail quand la liste des visuels change', async () => {
    await sync()
    await prisma.job.deleteMany({ where: { type: 'article.images' } })

    await sync({ images: ['https://images.exemple.fr/c.jpg'] })

    expect(await prisma.job.count({ where: { type: 'article.images' } })).toBe(1)
  })

  it('remplace les mesures et retire les clés disparues', async () => {
    await sync({ measurements: { chest: 54, length: 72 } })
    await sync({ measurements: { chest: 55 } })

    const measurements = await prisma.articleMeasurement.findMany({
      where: { article: { externalId: BASE.externalId } },
      select: { key: true, valueCm: true },
    })

    // Une mesure corrigée en amont doit pouvoir être RETIRÉE : la laisser en
    // place ferait mentir la fiche sur la pièce.
    expect(measurements).toEqual([{ key: 'chest', valueCm: 55 }])
  })

  it('une vraie description écrase le relevé composé, et baisse le drapeau', async () => {
    await sync()
    const generated = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { descriptionIsGenerated: true },
    })
    expect(generated.descriptionIsGenerated).toBe(true)

    await sync({ description: 'Chinée à Lille, portée deux étés.' })

    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: {
        descriptionIsGenerated: true,
        translations: { where: { locale: 'fr' }, select: { description: true } },
      },
    })

    expect(article.descriptionIsGenerated).toBe(false)
    expect(article.translations[0]?.description).toBe(
      'Chinée à Lille, portée deux étés.',
    )
  })

  it('archive sur demande', async () => {
    await sync()
    const result = await sync({ status: 'ARCHIVED' })

    expect(result.action).toBe('updated')
    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { status: true },
    })
    expect(article.status).toBe('ARCHIVED')
  })

  it('pose une date de mise en ligne à la première publication', async () => {
    // Le cas qui fait tomber le piège : une pièce envoyée d'emblée archivée.
    // Ses visuels arrivent, mais `publishIfPending` ne la publie pas — elle
    // n'est pas en brouillon. Sa date de mise en ligne reste donc nulle.
    await sync({ status: 'ARCHIVED' })
    await storeImages(BASE.images)

    const archived = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { status: true, publishedAt: true },
    })
    expect(archived.status).toBe('ARCHIVED')
    expect(archived.publishedAt).toBeNull()

    // L'application la remet en vente.
    const result = await sync({ status: 'AVAILABLE' })
    expect(result.published).toBe(true)

    const published = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { status: true, publishedAt: true, offersOpenAt: true },
    })

    expect(published.status).toBe('AVAILABLE')
    // Sans cette date, la pièce serait « disponible » ET introuvable :
    // `lib/db/visibility.ts` exige `publishedAt IS NOT NULL`, et le verrou de
    // stock aussi. Elle ne serait ni listée, ni consultable, ni achetable.
    expect(published.publishedAt).not.toBeNull()
    expect(published.offersOpenAt).not.toBeNull()
  })

  it('ne redate pas une pièce déjà publiée', async () => {
    await sync({ status: 'ARCHIVED' })
    await storeImages(BASE.images)
    await sync({ status: 'AVAILABLE' })

    const first = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { publishedAt: true },
    })

    await sync({ priceCents: 2900 })

    const second = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { publishedAt: true },
    })

    // Redater ferait remonter en tête du catalogue une pièce dont on vient
    // seulement de corriger le prix.
    expect(second.publishedAt).toEqual(first.publishedAt)
  })

  it('ne publie pas une pièce dont les visuels ne sont pas encore stockés', async () => {
    await sync()

    // L'application redemande `AVAILABLE`, mais aucune image n'est stockée :
    // la fiche reste en brouillon.
    const result = await sync({ status: 'AVAILABLE' })

    expect(result.published).toBe(false)
    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { status: true },
    })
    expect(article.status).toBe('DRAFT')
  })
})

// ---------------------------------------------------------------------------
// Ce que la caisse protège
// ---------------------------------------------------------------------------

describe('pièces que l’application ne peut plus toucher', () => {
  /**
   * Place la pièce dans l'état qu'aurait produit la caisse.
   *
   * `reservedById` n'est pas décoratif : la base porte une contrainte
   * `Article_reservation_coherent` qui refuse un verrou sans propriétaire ni
   * échéance. La poser ici, c'est tester contre l'état RÉEL d'une pièce en
   * cours de paiement, pas contre un état que la base n'accepterait jamais.
   */
  async function forceStatus(
    status: 'RESERVED' | 'SOLD',
    reservedUntil: Date | null = null,
  ): Promise<void> {
    await prisma.article.update({
      where: { externalId: BASE.externalId },
      data:
        status === 'RESERVED'
          ? {
              status,
              reservedUntil,
              reservedById: 'jeton-caisse-test',
            }
          : { status, soldAt: new Date() },
    })
  }

  it('refuse d’archiver une pièce en cours de paiement, avec l’échéance', async () => {
    await sync()
    const until = new Date(Date.now() + 15 * 60_000)
    await forceStatus('RESERVED', until)

    const result = await sync({ status: 'ARCHIVED' })

    expect(result.action).toBe('rejected')
    expect(result.reason).toBe('locked-by-checkout')
    // Sans échéance, l'application ne saurait pas quand réessayer.
    expect(result.lockedUntil).toBe(until.toISOString())

    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { status: true },
    })
    expect(article.status).toBe('RESERVED')
  })

  it('laisse corriger le prix d’une pièce réservée sans la libérer', async () => {
    await sync()
    await forceStatus('RESERVED', new Date(Date.now() + 15 * 60_000))

    const result = await sync({ priceCents: 3500 })

    expect(result.action).toBe('updated')
    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { status: true, priceCents: true },
    })

    // Le statut appartient à la caisse : le rendre disponible pendant un
    // paiement ferait vendre la pièce deux fois.
    expect(article.status).toBe('RESERVED')
    expect(article.priceCents).toBe(3500)
  })

  it('refuse toute écriture sur une pièce vendue', async () => {
    await sync()
    await forceStatus('SOLD')

    const result = await sync({ priceCents: 100 })

    expect(result.action).toBe('rejected')
    expect(result.reason).toBe('already-sold')

    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { priceCents: true },
    })
    // Le prix figure, figé, sur une facture qu'une cliente détient. La fiche
    // publique ne doit pas en raconter un autre.
    expect(article.priceCents).toBe(BASE.priceCents)
  })
})

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

describe('publication', () => {
  it('publie une fiche restée en brouillon, une seule fois', async () => {
    await sync()
    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { id: true },
    })

    const first = await prisma.$transaction((tx) =>
      publishIfPending(tx, article.id, 7),
    )
    expect(first).toBe(true)

    const published = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true, publishedAt: true, offersOpenAt: true },
    })
    expect(published.status).toBe('AVAILABLE')
    expect(published.publishedAt).not.toBeNull()
    expect(published.offersOpenAt).not.toBeNull()

    // Un second passage ne republie pas et ne redate pas : la date de mise en
    // ligne sert au tri « nouveautés », elle ne doit pas bouger parce qu'un
    // travail a été rejoué.
    const second = await prisma.$transaction((tx) =>
      publishIfPending(tx, article.id, 7),
    )
    expect(second).toBe(false)

    const after = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { publishedAt: true },
    })
    expect(after.publishedAt).toEqual(published.publishedAt)
  })

  it('ne publie pas une pièce archivée entre-temps', async () => {
    await sync()
    const article = await prisma.article.findUniqueOrThrow({
      where: { externalId: BASE.externalId },
      select: { id: true },
    })

    await prisma.article.update({
      where: { id: article.id },
      data: { status: 'ARCHIVED' },
    })

    const published = await prisma.$transaction((tx) =>
      publishIfPending(tx, article.id, 7),
    )

    // Le travail d'images tourne après coup : il ne doit pas remettre en vente
    // ce que l'application vient de retirer.
    expect(published).toBe(false)
  })
})
