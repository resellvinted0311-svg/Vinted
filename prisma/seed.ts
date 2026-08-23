import { PrismaClient, type ArticleCondition, type ArticleStatus } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { locales, type Locale } from '../lib/i18n/routing'
import { computeFloorPriceCents, DEFAULT_PRICING_CONFIG } from '../lib/domain/pricing'
import { ZONES, RATES, cheapestFrenchCarrierCostCents } from './seed-data/shipping'
import {
  CATEGORIES,
  BRANDS,
  MATERIALS,
  FITS,
  COLORS,
  CONDITION_TEXT,
  DEFECTS,
  DESCRIPTION_TEMPLATE,
} from './seed-data/catalogue'

const prisma = new PrismaClient()

/**
 * Générateur pseudo-aléatoire déterministe.
 *
 * Un seed rejoué doit produire exactement le même catalogue : sinon les tests
 * end-to-end qui ciblent un article précis deviennent instables.
 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260812)

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)]
  if (item === undefined) throw new Error('Tirage dans une liste vide.')
  return item
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

async function seedSettings(): Promise<void> {
  const settings: { key: string; value: unknown }[] = [
    { key: 'packagingWeightGrams', value: 80 },
    { key: 'shippingMarkupPercent', value: 20 },
    { key: 'reservationTtlMinutes', value: 15 },
    { key: 'offersOpenAfterDays', value: 7 },
    { key: 'offerResponseHours', value: 48 },
    { key: 'acceptedOfferValidityHours', value: 24 },
    { key: 'minOfferAmountCents', value: 800 },
    { key: 'maxOffersPerArticlePerUser', value: 3 },
    { key: 'offerCooldownAfterRejectionHours', value: 48 },
    { key: 'minMarginCents', value: DEFAULT_PRICING_CONFIG.minMarginCents },
    { key: 'contributionRateBps', value: DEFAULT_PRICING_CONFIG.contributionRateBps },
    { key: 'stripePercentBps', value: DEFAULT_PRICING_CONFIG.stripePercentBps },
    { key: 'stripeFixedCents', value: DEFAULT_PRICING_CONFIG.stripeFixedCents },
    { key: 'autoDropSchedule', value: [{ days: 30, percent: 10 }, { days: 60, percent: 20 }] },

    // Zone de référence du prix plancher : celle où la boutique vend le plus.
    // Le plancher intègre le port, et le port dépend de la zone — sans ce
    // réglage, il faudrait en choisir une dans le code.
    { key: 'floorShippingZoneCode', value: 'FR' },

    // Auto-acceptation des offres : codée, mais DÉSACTIVÉE par défaut.
    // Si les acheteurs découvrent qu'une offre basse passe seule, le prix
    // affiché devient décoratif.
    { key: 'autoAcceptOffersEnabled', value: false },
    { key: 'autoAcceptThresholdPercent', value: null },

    // Frais de retour à la charge du client, sauf non-conformité.
    // Le port ALLER au tarif standard est remboursé dans tous les cas :
    // c'est une obligation légale, pas une option commerciale.
    { key: 'returnShippingPaidByCustomer', value: true },
    { key: 'refundOutboundShippingOnWithdrawal', value: true },
    { key: 'withdrawalPeriodDays', value: 14 },

    // Coefficients d'impact : délibérément vides.
    // Tant qu'ils ne sont pas renseignés depuis une source vérifiée (ADEME /
    // Refashion), le bloc d'impact ne s'affiche pas. Aucun chiffre inventé.
    {
      key: 'impactCoefficients',
      value: {
        source: null,
        updatedAt: null,
        note: "À renseigner depuis une source vérifiée (ADEME, Refashion). Tant que `source` est null, le bloc d'impact reste masqué.",
        byCategory: {},
      },
    },

    { key: 'cgvVersion', value: '2026-01' },
  ]

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value as never },
      update: { value: setting.value as never },
    })
  }

  console.info(`  Paramètres : ${settings.length}`)
}

// ---------------------------------------------------------------------------
// Expédition
// ---------------------------------------------------------------------------

async function seedShipping(): Promise<void> {
  const zoneIdByCode = new Map<string, string>()

  for (const zone of ZONES) {
    const record = await prisma.shippingZone.upsert({
      where: { code: zone.code },
      create: {
        code: zone.code,
        name: zone.name,
        countries: zone.countries,
        postalPrefixes: zone.postalPrefixes ?? [],
        freeShippingThresholdCents: zone.freeShippingThresholdCents,
        position: zone.position,
        requiresCustoms: zone.requiresCustoms ?? false,
      },
      update: {
        name: zone.name,
        countries: zone.countries,
        postalPrefixes: zone.postalPrefixes ?? [],
        freeShippingThresholdCents: zone.freeShippingThresholdCents,
        position: zone.position,
        requiresCustoms: zone.requiresCustoms ?? false,
      },
    })
    zoneIdByCode.set(zone.code, record.id)
  }

  for (const rate of RATES) {
    const zoneId = zoneIdByCode.get(rate.zoneCode)
    if (!zoneId) throw new Error(`Zone inconnue : ${rate.zoneCode}`)

    await prisma.shippingRate.upsert({
      where: {
        zoneId_carrierCode_serviceCode_maxWeightGrams: {
          zoneId,
          carrierCode: rate.carrierCode,
          serviceCode: rate.serviceCode,
          maxWeightGrams: rate.maxWeightGrams,
        },
      },
      create: {
        zoneId,
        carrierCode: rate.carrierCode,
        serviceCode: rate.serviceCode,
        label: rate.label,
        maxWeightGrams: rate.maxWeightGrams,
        priceCents: rate.priceCents,
        deliveryDaysMin: rate.deliveryDaysMin,
        deliveryDaysMax: rate.deliveryDaysMax,
        requiresServicePoint: rate.requiresServicePoint ?? false,
      },
      update: { priceCents: rate.priceCents },
    })
  }

  console.info(`  Zones : ${ZONES.length} · Tarifs : ${RATES.length}`)
}

// ---------------------------------------------------------------------------
// Catalogue de référence
// ---------------------------------------------------------------------------

async function seedTaxonomy(): Promise<Map<string, string>> {
  const categoryIdBySlug = new Map<string, string>()

  // Deux passes : les parents d'abord, pour que parentId soit résoluble.
  const roots = CATEGORIES.filter((c) => !c.parentSlug)
  const children = CATEGORIES.filter((c) => c.parentSlug)

  for (const category of [...roots, ...children]) {
    const parentId = category.parentSlug
      ? categoryIdBySlug.get(category.parentSlug)
      : null

    if (category.parentSlug && !parentId) {
      throw new Error(`Catégorie parente introuvable : ${category.parentSlug}`)
    }

    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      create: {
        slug: category.slug,
        parentId: parentId ?? null,
        position: category.position,
        defaultWeightGrams: category.defaultWeightGrams ?? null,
        measurementKeys: category.measurementKeys ?? [],
      },
      update: {
        parentId: parentId ?? null,
        position: category.position,
        defaultWeightGrams: category.defaultWeightGrams ?? null,
        measurementKeys: category.measurementKeys ?? [],
      },
    })

    categoryIdBySlug.set(category.slug, record.id)

    for (const locale of locales) {
      await prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: record.id, locale } },
        create: {
          categoryId: record.id,
          locale,
          name: category.names[locale],
        },
        update: { name: category.names[locale] },
      })
    }
  }

  for (const brand of BRANDS) {
    await prisma.brand.upsert({
      where: { slug: brand.slug },
      create: {
        slug: brand.slug,
        name: brand.name,
        isLuxury: brand.isLuxury ?? false,
      },
      update: { name: brand.name, isLuxury: brand.isLuxury ?? false },
    })
  }

  console.info(
    `  Catégories : ${CATEGORIES.length} (× ${locales.length} langues) · Marques : ${BRANDS.length}`,
  )

  return categoryIdBySlug
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

/** Catégories feuilles : seules elles portent des articles. */
const LEAF_SLUGS = [
  't-shirts', 'chemises', 'pulls-sweats', 'jeans-pantalons',
  'robes', 'vestes-legeres', 'manteaux', 'chaussures', 'accessoires', 'sacs',
] as const

const SIZES_BY_SLUG: Record<string, string[]> = {
  't-shirts': ['XS', 'S', 'M', 'L', 'XL'],
  chemises: ['XS', 'S', 'M', 'L', 'XL'],
  'pulls-sweats': ['S', 'M', 'L', 'XL'],
  'jeans-pantalons': ['W28', 'W30', 'W32', 'W34', 'W36'],
  robes: ['34', '36', '38', '40', '42'],
  'vestes-legeres': ['S', 'M', 'L', 'XL'],
  manteaux: ['S', 'M', 'L', 'XL'],
  chaussures: ['38', '39', '40', '41', '42', '43', '44'],
  accessoires: ['S', 'M', 'L'],
  sacs: ['TU'],
}

const MEASUREMENT_RANGES: Record<string, [number, number]> = {
  shoulders: [38, 52],
  chest: [46, 62],
  waist: [36, 50],
  hips: [44, 58],
  length: [58, 96],
  sleeve: [55, 68],
  inseam: [72, 86],
  footLength: [24, 29],
}

interface PlannedArticle {
  status: ArticleStatus
  publishedDaysAgo: number | null
  scheduledInDays?: number
}

/**
 * Répartition des 50 articles.
 *
 * Volontairement variée pour que chaque mécanique soit testable dès la
 * Phase 1 : articles récents (offres encore fermées), articles anciens
 * (offres ouvertes, baisse automatique due), articles vendus (qui doivent
 * rester accessibles en 200), brouillons et drops programmés.
 */
function planArticles(): PlannedArticle[] {
  const plan: PlannedArticle[] = []

  // 6 articles publiés il y a moins de 7 jours : offres encore fermées.
  for (let i = 0; i < 6; i += 1) {
    plan.push({ status: 'AVAILABLE', publishedDaysAgo: randInt(0, 6) })
  }
  // 22 articles entre 8 et 29 jours : offres ouvertes, pas encore de baisse.
  for (let i = 0; i < 22; i += 1) {
    plan.push({ status: 'AVAILABLE', publishedDaysAgo: randInt(8, 29) })
  }
  // 9 articles entre 31 et 59 jours : première baisse automatique due.
  for (let i = 0; i < 9; i += 1) {
    plan.push({ status: 'AVAILABLE', publishedDaysAgo: randInt(31, 59) })
  }
  // 5 articles de plus de 60 jours : seconde baisse due, stock dormant.
  for (let i = 0; i < 5; i += 1) {
    plan.push({ status: 'AVAILABLE', publishedDaysAgo: randInt(61, 120) })
  }
  // 5 articles vendus : ils doivent rester accessibles, jamais en 404.
  for (let i = 0; i < 5; i += 1) {
    plan.push({ status: 'SOLD', publishedDaysAgo: randInt(20, 90) })
  }
  // 2 drops programmés.
  plan.push({ status: 'SCHEDULED', publishedDaysAgo: null, scheduledInDays: 3 })
  plan.push({ status: 'SCHEDULED', publishedDaysAgo: null, scheduledInDays: 10 })
  // 1 brouillon.
  plan.push({ status: 'DRAFT', publishedDaysAgo: null })

  return plan
}

async function seedArticles(
  categoryIdBySlug: Map<string, string>,
): Promise<void> {
  const brandRecords = await prisma.brand.findMany({
    select: { id: true, slug: true, name: true },
  })
  const categoryBySlug = new Map(
    CATEGORIES.map((category) => [category.slug, category]),
  )

  const plan = planArticles()
  const materialKeys = Object.keys(MATERIALS)
  const fitKeys = Object.keys(FITS)
  const colorKeys = Object.keys(COLORS)
  const defectKeys = Object.keys(DEFECTS)
  const conditions: ArticleCondition[] = [
    'NEW_WITH_TAGS', 'NEW_WITHOUT_TAGS', 'VERY_GOOD', 'VERY_GOOD', 'GOOD', 'GOOD', 'FAIR',
  ]

  for (const [index, planned] of plan.entries()) {
    const sequence = index + 1
    const sku = `ART-${String(sequence).padStart(6, '0')}`

    const categorySlug = pick(LEAF_SLUGS)
    const category = categoryBySlug.get(categorySlug)
    const categoryId = categoryIdBySlug.get(categorySlug)
    if (!category || !categoryId) {
      throw new Error(`Catégorie feuille introuvable : ${categorySlug}`)
    }

    const brand = pick(brandRecords)
    const condition = pick(conditions)
    const materialKey = pick(materialKeys)
    const fitKey = pick(fitKeys)
    const colorKey = pick(colorKeys)

    // Un défaut n'est mentionné que sur les états qui en comportent.
    const defectKey =
      condition === 'GOOD' || condition === 'FAIR'
        ? pick(defectKeys)
        : null

    const sizes = SIZES_BY_SLUG[categorySlug] ?? ['TU']
    const sizeLabel = pick(sizes)

    const weightGrams = category.defaultWeightGrams ?? 300

    // Économie de l'article. Le prix de vente doit rester au-dessus du
    // plancher : un article de test déficitaire fausserait les garde-fous.
    const costCents = randInt(150, 1200)
    const floorPriceCents = computeFloorPriceCents({
      costCents,
      estimatedShippingCostCents: cheapestFrenchCarrierCostCents(weightGrams + 80),
    })
    const priceCents = Math.max(
      floorPriceCents + randInt(200, 2600),
      floorPriceCents,
    )

    const publishedAt =
      planned.publishedDaysAgo === null
        ? null
        : daysAgo(planned.publishedDaysAgo)

    // Les offres n'ouvrent qu'au bout de 7 jours : le drop se vend au prix
    // affiché ou pas du tout.
    const offersOpenAt = publishedAt
      ? new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
      : null

    // Le tirage aléatoire se fait AVANT l'upsert, jamais à l'intérieur : la
    // séquence du générateur doit être identique que la ligne existe déjà ou
    // non, sinon le seed cesse d'être déterministe.
    const soldAt = planned.status === 'SOLD' ? daysAgo(randInt(1, 15)) : null
    const viewCount = randInt(0, 340)
    const sourcedAt = daysAgo(randInt(30, 200))
    const sourcedFrom = pick([
      'réderie Albert', 'brocante Amiens', 'dépôt-vente Lille',
      'vide-grenier Roubaix', 'friperie Bruxelles',
    ])

    const articleData = {
      slug: `${categorySlug}-${brand.slug}-${sizeLabel.toLowerCase()}-${sequence}`,
      brandId: brand.id,
      categoryId,
      condition,
      sizeLabel,
      sizeNormalized: sizeLabel.toUpperCase(),
      color: colorKey,
      material: materialKey,
      fit: fitKey,
      priceCents,
      costCents,
      floorPriceCents,
      weightGrams,
      status: planned.status,
      publishedAt,
      offersOpenAt,
      scheduledAt:
        planned.scheduledInDays === undefined
          ? null
          : daysFromNow(planned.scheduledInDays),
      soldAt,
      allowOffers: true,
      // Refus automatique très bas, proche du prix de revient : c'est le
      // seul automatisme actif du système d'offres.
      minOfferCents: Math.round(floorPriceCents * 0.9),
      viewCount,
      sourcedAt,
      sourcedFrom,
    }

    // Même charge utile en création et en mise à jour : rejouer le seed fait
    // converger la base vers l'état décrit par le code, au lieu de laisser
    // traîner des lignes semées par une version antérieure.
    const article = await prisma.article.upsert({
      where: { sku },
      create: { sku, ...articleData },
      update: articleData,
      select: { id: true },
    })

    // ---- Traductions dans les 8 langues -----------------------------------
    for (const locale of locales as readonly Locale[]) {
      const singular = category.singular?.[locale] ?? category.names[locale]
      const title = `${singular} ${brand.name}`

      const description = DESCRIPTION_TEMPLATE[locale]({
        material: MATERIALS[materialKey]?.[locale] ?? materialKey,
        fit: FITS[fitKey]?.[locale] ?? fitKey,
        color: COLORS[colorKey]?.[locale] ?? colorKey,
        condition: CONDITION_TEXT[condition]?.[locale] ?? '',
        defect: defectKey ? (DEFECTS[defectKey]?.[locale] ?? null) : null,
      })

      await prisma.articleTranslation.upsert({
        where: { articleId_locale: { articleId: article.id, locale } },
        create: {
          articleId: article.id,
          locale,
          title,
          description,
          // Le français est la langue de rédaction ; le reste serait
          // traduit par machine en production.
          isMachineTranslated: locale !== 'fr',
        },
        update: { title, description },
      })
    }

    // ---- Images -----------------------------------------------------------
    const imageCount = randInt(2, 4)
    await prisma.articleImage.deleteMany({ where: { articleId: article.id } })
    for (let position = 0; position < imageCount; position += 1) {
      await prisma.articleImage.create({
        data: {
          articleId: article.id,
          url: `/placeholder/${sku}-${position}/900/1200`,
          width: 900,
          height: 1200,
          position,
          alt: `${sku} — vue ${position + 1}`,
        },
      })
    }

    // ---- Mesures réelles --------------------------------------------------
    // C'est le premier facteur de conversion et de réduction des retours :
    // aucun article n'est publié sans ses mesures.
    for (const key of category.measurementKeys ?? []) {
      const range = MEASUREMENT_RANGES[key]
      if (!range) continue
      const valueCm = randInt(range[0], range[1])
      await prisma.articleMeasurement.upsert({
        where: { articleId_key: { articleId: article.id, key } },
        create: { articleId: article.id, key, valueCm },
        update: { valueCm },
      })
    }
  }

  console.info(`  Articles : ${plan.length} (× ${locales.length} langues)`)
}

// ---------------------------------------------------------------------------
// Comptes de test
// ---------------------------------------------------------------------------

/**
 * Comptes de démonstration.
 *
 * ---------------------------------------------------------------------------
 * Deux verrous, parce qu'un seul a déjà cédé
 * ---------------------------------------------------------------------------
 * Ce bloc a réellement créé un compte ADMIN sur la base de PRODUCTION, avec un
 * mot de passe écrit en clair dans un dépôt public. Le script de build lançait
 * le seed dès qu'il trouvait un catalogue vide — ce qui est exactement l'état
 * d'une base neuve — et rien ici ne demandait dans quel environnement il
 * s'exécutait.
 *
 * Désormais :
 *
 *  1. refus net en production, quel que soit l'appelant ;
 *  2. mot de passe lu dans l'environnement, SANS valeur de repli. Variable
 *     absente, aucun compte créé. Un mot de passe écrit dans le code finit
 *     toujours par être publié avec lui.
 *
 * Le rôle ADMIN n'ouvre encore sur rien — /admin n'existe pas — mais ce compte
 * deviendrait un accès complet à la seconde où la première page
 * d'administration serait déposée.
 */
async function seedUsers(): Promise<void> {
  if (
    process.env.VERCEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
  ) {
    console.info('  Comptes de démonstration : ignorés (environnement de production)')
    return
  }

  const password = process.env.SEED_ADMIN_PASSWORD
  if (!password || password.length < 12) {
    console.info(
      '  Comptes de démonstration : ignorés (SEED_ADMIN_PASSWORD absente ou trop courte)',
    )
    return
  }

  const argon2Options = { memoryCost: 19456, timeCost: 2, parallelism: 1 }
  const passwordHash = await hash(password, argon2Options)

  await prisma.user.upsert({
    where: { email: 'admin@nina-diego.test' },
    create: {
      email: 'admin@nina-diego.test',
      passwordHash,
      firstName: 'Nina',
      lastName: 'Administration',
      role: 'ADMIN',
      locale: 'fr',
      emailVerified: new Date(),
    },
    update: { passwordHash, role: 'ADMIN' },
  })

  await prisma.user.upsert({
    where: { email: 'client@nina-diego.test' },
    create: {
      email: 'client@nina-diego.test',
      passwordHash,
      firstName: 'Diego',
      lastName: 'Client',
      role: 'CUSTOMER',
      locale: 'fr',
      emailVerified: new Date(),
      marketingConsent: false,
    },
    update: { passwordHash },
  })

  /**
   * Second compte client, réservé aux tests de bout en bout du RGPD.
   *
   * ---------------------------------------------------------------------------
   * Pourquoi deux comptes et non un seul
   * ---------------------------------------------------------------------------
   * `signInAction` borne les tentatives à DIX par compte et par quart d'heure.
   * Tant que tous les tests de connexion partageaient `client@`, une seule
   * exécution complète de la suite en consommait exactement dix — cinq par
   * navigateur — et les deux derniers tombaient sur « Trop de tentatives ».
   *
   * On ne desserre pas la limite : dix essais par quart d'heure sur un compte
   * donné est exactement ce qu'il faut contre le bourrage d'identifiants. On
   * répartit les tests sur deux comptes, ce qui est aussi plus proche de la
   * réalité qu'ils décrivent — plusieurs personnes, pas une seule.
   */
  await prisma.user.upsert({
    where: { email: 'client2@nina-diego.test' },
    create: {
      email: 'client2@nina-diego.test',
      passwordHash,
      firstName: 'Camille',
      lastName: 'Cliente',
      role: 'CUSTOMER',
      locale: 'fr',
      emailVerified: new Date(),
      marketingConsent: false,
    },
    update: { passwordHash },
  })

  console.info(
    '  Comptes de démonstration : admin@nina-diego.test · client@nina-diego.test · client2@nina-diego.test',
  )
}

// ---------------------------------------------------------------------------
// Compteurs séquentiels
// ---------------------------------------------------------------------------

async function seedCounters(): Promise<void> {
  // Numéros de commande et de facture : séquences sans trou, exigées par
  // l'obligation comptable.
  for (const key of ['order:2026', 'invoice:2026']) {
    await prisma.counter.upsert({
      where: { key },
      create: { key, value: 0 },
      update: {},
    })
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.info('Seed — Nina & Diego')

  await seedSettings()
  await seedShipping()
  const categoryIdBySlug = await seedTaxonomy()
  await seedArticles(categoryIdBySlug)
  await seedUsers()
  await seedCounters()

  console.info('Seed terminé.')
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
