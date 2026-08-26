import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import type { ArticleStatus } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { applyDuePriceDrops } from '@/lib/shop/price-drop'

/**
 * La baisse automatique des prix, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi l'horloge de ces tests est en 2020
 * ---------------------------------------------------------------------------
 * Le balayage traite TOUTES les pièces assez anciennes — c'est son travail.
 * Les autres fichiers de test créent des pièces publiées en 2026, et le jeu
 * de données aussi : un balayage à l'heure réelle les baisserait pendant que
 * leurs propres tests s'exécutent, et casserait leurs attentes de prix.
 *
 * En plaçant `now` en 2020, seules les pièces de CE fichier — publiées avant —
 * atteignent un palier. Tout ce qui est publié en 2026 est dans le futur du
 * balayage, donc invisible pour lui. L'isolation vient du paramètre que la
 * fonction expose déjà pour être testable, pas d'un aménagement du code.
 */

const PREFIX = 'DROP-'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2020-06-01T12:00:00.000Z')

/**
 * Le barème sous lequel les attentes de ce fichier sont vraies.
 *
 * Un jeu d'essai, pas une politique commerciale : le vrai barème vit dans
 * `Setting.autoDropSchedule`, se règle en back-office, et n'apparaît nulle
 * part dans le dépôt. Ces deux paliers sont ici pour que « 20,00 € à 35 jours
 * donne 18,00 € » veuille dire quelque chose.
 */
const SCHEDULE = [
  { days: 30, percent: 10 },
  { days: 60, percent: 20 },
]

function publishedDaysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY)
}

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { type: 'sync.notify' } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

beforeEach(async () => {
  await cleanup()
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await cleanup()
  vi.unstubAllEnvs()
  await prisma.$disconnect()
})

interface ArticleSeed {
  daysOld?: number
  priceCents?: number
  floorPriceCents?: number
  comparePriceCents?: number | null
  minOfferCents?: number | null
  autoDropEnabled?: boolean
  status?: ArticleStatus
  externalId?: string | null
}

async function makeArticle(suffix: string, seed: ArticleSeed = {}): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
  const status = seed.status ?? 'AVAILABLE'
  const reserved = status === 'RESERVED'

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `drop-${suffix}`,
      externalId: seed.externalId === undefined ? null : seed.externalId,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: seed.priceCents ?? 2000,
      comparePriceCents: seed.comparePriceCents ?? null,
      minOfferCents: seed.minOfferCents ?? null,
      costCents: 300,
      floorPriceCents: seed.floorPriceCents ?? 1000,
      weightGrams: 400,
      status,
      autoDropEnabled: seed.autoDropEnabled ?? true,
      publishedAt:
        status === 'DRAFT' ? null : publishedDaysAgo(seed.daysOld ?? 35),
      // La contrainte de cohérence exige les trois colonnes ensemble.
      ...(reserved
        ? {
            reservedById: 'jeton-reservation-drop',
            reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
          }
        : {}),
      categoryId: category.id,
    },
    select: { id: true },
  })

  return article.id
}

function readArticle(id: string) {
  return prisma.article.findUniqueOrThrow({
    where: { id },
    select: {
      priceCents: true,
      comparePriceCents: true,
      lastPriceDropAt: true,
      minOfferCents: true,
    },
  })
}

// ---------------------------------------------------------------------------
// Ce que le barème prescrit
// ---------------------------------------------------------------------------

describe('application du barème', () => {
  it('applique le palier dû et pose le prix barré', async () => {
    const id = await makeArticle('p1', { daysOld: 35, priceCents: 2000 })

    const dropped = await applyDuePriceDrops(NOW, SCHEDULE)
    expect(dropped).toBe(1)

    const after = await readArticle(id)
    expect(after).toMatchObject({
      priceCents: 1800,
      // Le barré porte le prix d'AVANT : c'est lui qui rend la remise
      // affichable, et il a réellement été pratiqué.
      comparePriceCents: 2000,
      lastPriceDropAt: NOW,
    })
  })

  it('calcule le second palier depuis l’ORIGINE, jamais en cascade', async () => {
    // Déjà baissée à −10 % : 2000 → 1800, barré 2000. Le second palier doit
    // rendre 1600 (−20 % de 2000), pas 1440 (−20 % de 1800).
    const id = await makeArticle('p2', {
      daysOld: 65,
      priceCents: 1800,
      comparePriceCents: 2000,
    })

    await applyDuePriceDrops(NOW, SCHEDULE)

    const after = await readArticle(id)
    expect(after.priceCents).toBe(1600)
    expect(after.comparePriceCents).toBe(2000)
  })

  it('rattrape directement le dernier palier atteint', async () => {
    // Soixante-dix jours, jamais baissée — le barème vient d'être activé.
    // Elle va à −20 % en un seul passage, sans étape intermédiaire.
    const id = await makeArticle('p3', { daysOld: 70, priceCents: 2000 })

    await applyDuePriceDrops(NOW, SCHEDULE)

    expect((await readArticle(id)).priceCents).toBe(1600)
  })

  it('écrête au plancher quand la baisse pleine passerait dessous', async () => {
    // −20 % de 2000 = 1600, sous le plancher de 1700 : la pièce descend à
    // 1700 et pas plus bas. Vendre à perte n'est jamais une décision de cron.
    const id = await makeArticle('p4', {
      daysOld: 70,
      priceCents: 2000,
      floorPriceCents: 1700,
    })

    await applyDuePriceDrops(NOW, SCHEDULE)

    expect((await readArticle(id)).priceCents).toBe(1700)
  })

  it('n’écrit RIEN quand l’écrêtage rend la baisse nulle', async () => {
    // Déjà au plancher : le prix cible égale le prix courant. Écrire quand
    // même daterait une baisse qui n'a pas eu lieu — la pièce remonterait
    // dans le tri « dernières baisses » sans qu'aucun prix n'ait bougé — et
    // poserait un barré égal au prix, qui n'est pas une remise.
    const id = await makeArticle('p5', {
      daysOld: 70,
      priceCents: 1700,
      floorPriceCents: 1700,
    })

    const dropped = await applyDuePriceDrops(NOW, SCHEDULE)
    expect(dropped).toBe(0)

    const after = await readArticle(id)
    expect(after).toMatchObject({
      priceCents: 1700,
      comparePriceCents: null,
      lastPriceDropAt: null,
    })
  })

  it('est idempotent : un second passage ne rebaisse rien', async () => {
    const id = await makeArticle('p6', { daysOld: 35, priceCents: 2000 })

    expect(await applyDuePriceDrops(NOW, SCHEDULE)).toBe(1)
    expect(await applyDuePriceDrops(NOW, SCHEDULE)).toBe(0)

    expect((await readArticle(id)).priceCents).toBe(1800)
  })

  it('lit le barème dans la table Setting quand on ne lui en donne pas', async () => {
    // C'est le chemin de PRODUCTION : le cron n'a pas de barème à passer, il
    // lit celui qui est réglé en base.
    //
    // Le barème est posé ICI, pas hérité du seed. Ce test dépendait autrefois
    // des valeurs semées, et il est tombé le jour où elles ont changé — ce qui
    // était le bon signal pour une mauvaise raison : il n'avait rien à dire sur
    // ce changement. Depuis que les nombres du seed sont explicitement fictifs
    // et destinés à bouger, s'y adosser n'a plus de sens du tout.
    await prisma.setting.update({
      where: { key: 'autoDropSchedule' },
      data: { value: [{ days: 30, percent: 10 }] },
    })

    const id = await makeArticle('p7', { daysOld: 35, priceCents: 2000 })

    const dropped = await applyDuePriceDrops(NOW)
    expect(dropped).toBe(1)
    expect((await readArticle(id)).priceCents).toBe(1800)
  })

  it('un barème vide désactive le balayage', async () => {
    const id = await makeArticle('p8', { daysOld: 200, priceCents: 2000 })

    expect(await applyDuePriceDrops(NOW, [])).toBe(0)
    expect((await readArticle(id)).priceCents).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// Ce que le réglage refuse
// ---------------------------------------------------------------------------

describe('validation du barème', () => {
  it('refuse un barème dont les remises décroissent avec l’ancienneté', async () => {
    // Le palier dû est le plus ANCIEN atteint : avec une remise qui décroît,
    // les pièces les plus vieilles seraient vendues plus cher que les jeunes.
    // C'est une faute de saisie du back-office, à refuser à la lecture.
    const { getAutoDropSchedule } = await import('@/lib/config/settings')

    const kept = await prisma.setting.findUniqueOrThrow({
      where: { key: 'autoDropSchedule' },
      select: { value: true },
    })

    try {
      await prisma.setting.update({
        where: { key: 'autoDropSchedule' },
        data: {
          value: [
            { days: 30, percent: 20 },
            { days: 60, percent: 10 },
          ],
        },
      })

      await expect(getAutoDropSchedule()).rejects.toThrow(
        /autoDropSchedule/,
      )
    } finally {
      await prisma.setting.update({
        where: { key: 'autoDropSchedule' },
        data: { value: kept.value ?? [] },
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Ce que le balayage ne touche pas
// ---------------------------------------------------------------------------

describe('périmètre', () => {
  it('épargne les pièces trop jeunes', async () => {
    const id = await makeArticle('s1', { daysOld: 20, priceCents: 2000 })
    await applyDuePriceDrops(NOW, SCHEDULE)
    expect((await readArticle(id)).priceCents).toBe(2000)
  })

  it('respecte le refus pièce par pièce', async () => {
    // `autoDropEnabled: false` : une pièce rare peut attendre son prix
    // indéfiniment, et c'est une décision du vendeur, pas du barème.
    const id = await makeArticle('s2', { daysOld: 70, autoDropEnabled: false })
    await applyDuePriceDrops(NOW, SCHEDULE)
    expect((await readArticle(id)).priceCents).toBe(2000)
  })

  it('épargne les pièces vendues, réservées et les brouillons', async () => {
    // SOLD : le prix est sur une facture. RESERVED : quelqu'un paie, carte en
    // main. DRAFT : pas de date de publication, donc pas d'âge.
    const sold = await makeArticle('s3', { daysOld: 70, status: 'SOLD' })
    const reserved = await makeArticle('s4', { daysOld: 70, status: 'RESERVED' })
    const draft = await makeArticle('s5', { status: 'DRAFT' })

    const dropped = await applyDuePriceDrops(NOW, SCHEDULE)
    expect(dropped).toBe(0)

    for (const id of [sold, reserved, draft]) {
      expect((await readArticle(id)).priceCents).toBe(2000)
    }
  })

  it('ne remonte JAMAIS un prix', async () => {
    // Prix barré fourni par l'application de gestion : « était à 5000,
    // affichée 4000 ». La base du barème est le barré, et −10 % de 5000 fait
    // 4500 — AU-DESSUS du prix affiché. Une pièce déjà remisée à −20 % n'a
    // pas à remonter parce qu'un palier n'en demande que −10.
    const id = await makeArticle('s6', {
      daysOld: 35,
      priceCents: 4000,
      comparePriceCents: 5000,
      floorPriceCents: 1000,
    })

    const dropped = await applyDuePriceDrops(NOW, SCHEDULE)
    expect(dropped).toBe(0)
    expect((await readArticle(id)).priceCents).toBe(4000)
  })
})

// ---------------------------------------------------------------------------
// Ce que la baisse répare au passage
// ---------------------------------------------------------------------------

describe('seuil de refus automatique des offres', () => {
  it('retire un seuil que la baisse a rattrapé', async () => {
    // Prix 2000 → 1800, seuil de refus à 1900 : toute offre possible serait
    // désormais sous le seuil, auto-refusée en brûlant tentatives et
    // carences. Un seuil qui refuse tout n'est plus un seuil.
    const id = await makeArticle('m1', {
      daysOld: 35,
      priceCents: 2000,
      minOfferCents: 1900,
    })

    await applyDuePriceDrops(NOW, SCHEDULE)

    const after = await readArticle(id)
    expect(after.priceCents).toBe(1800)
    expect(after.minOfferCents).toBeNull()
  })

  it('garde un seuil encore utile', async () => {
    const id = await makeArticle('m2', {
      daysOld: 35,
      priceCents: 2000,
      minOfferCents: 1500,
    })

    await applyDuePriceDrops(NOW, SCHEDULE)

    expect((await readArticle(id)).minOfferCents).toBe(1500)
  })
})

// ---------------------------------------------------------------------------
// Ce qui remonte vers l'application de gestion
// ---------------------------------------------------------------------------

describe('remontée de la baisse', () => {
  it('inscrit l’événement avec le prix d’AVANT, dans la même transaction', async () => {
    vi.stubEnv('SYNC_WEBHOOK_URL', 'https://application.test/webhook')
    vi.stubEnv('SYNC_WEBHOOK_SECRET', 'secret-de-test-remontee-drop')

    const id = await makeArticle('e1', {
      daysOld: 35,
      priceCents: 2000,
      externalId: 'DROP-ext-e1',
    })

    await applyDuePriceDrops(NOW, SCHEDULE)

    const jobs = await prisma.job.findMany({
      where: { type: 'sync.notify' },
      select: { payload: true },
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toMatchObject({
      event: 'article.price_dropped',
      articleId: id,
      // Capturé avant l'écriture : une fois la baisse écrite, ce montant
      // n'existe plus nulle part — le barré porte l'origine, pas lui.
      previousPriceCents: 2000,
      // L'instant du balayage, figé : la clé d'idempotence de l'autre côté.
      occurredAt: NOW.toISOString(),
    })
  })

  it('une pièce née ici baisse sans rien remonter', async () => {
    vi.stubEnv('SYNC_WEBHOOK_URL', 'https://application.test/webhook')
    vi.stubEnv('SYNC_WEBHOOK_SECRET', 'secret-de-test-remontee-drop')

    // `externalId` nul : l'application ne connaît pas cette pièce, il n'y a
    // personne à prévenir. La baisse, elle, doit quand même s'appliquer.
    const id = await makeArticle('e2', { daysOld: 35, priceCents: 2000 })

    expect(await applyDuePriceDrops(NOW, SCHEDULE)).toBe(1)
    expect((await readArticle(id)).priceCents).toBe(1800)
    expect(await prisma.job.count({ where: { type: 'sync.notify' } })).toBe(0)
  })
})
