import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import type { ArticleStatus } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { listOffers } from '@/lib/db/queries/offers'

/**
 * Le registre des offres : ce qu'il montre, et surtout à qui.
 *
 * La page `/compte/offres` n'a aucun paramètre — pas de numéro à saisir, pas
 * d'identifiant dans l'URL. Toute sa sûreté tient donc dans la portée de cette
 * requête, et c'est elle que ces tests exercent : contre une vraie base, avec
 * deux comptes et une offre déposée sans compte.
 */

const PREFIX = 'REG-OFFRE-'
const HOUR = 60 * 60 * 1000

async function cleanup(): Promise<void> {
  await prisma.offer.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({
    where: { email: { endsWith: '@registre-offres.test' } },
  })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeUser(email: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email, role: 'CUSTOMER' },
    select: { id: true },
  })
  return user.id
}

async function makeArticle(
  suffix: string,
  {
    priceCents = 3800,
    status = 'AVAILABLE' as ArticleStatus,
    title = 'Manteau de laine',
  } = {},
): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `registre-offre-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents,
      // Les deux montants que le registre ne doit JAMAIS laisser sortir.
      costCents: 900,
      floorPriceCents: 2100,
      weightGrams: 500,
      status,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
      translations: {
        create: [
          { locale: 'fr', title, description: 'Description.' },
          { locale: 'en', title: 'Wool coat', description: 'Description.' },
        ],
      },
    },
    select: { id: true },
  })

  return article.id
}

interface OfferSeed {
  articleId: string
  userId?: string | null
  guestSessionToken?: string | null
  guestEmail?: string | null
  amountCents?: number
  status?:
    | 'PENDING'
    | 'ACCEPTED'
    | 'COUNTERED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'VOIDED'
    | 'CONSUMED'
  expiresInHours?: number
  priceValidInHours?: number | null
  parentOfferId?: string | null
  createdAt?: Date
}

async function makeOffer(seed: OfferSeed): Promise<string> {
  const now = Date.now()
  const offer = await prisma.offer.create({
    data: {
      articleId: seed.articleId,
      userId: seed.userId ?? null,
      guestSessionToken: seed.guestSessionToken ?? null,
      guestEmail: seed.guestEmail ?? null,
      amountCents: seed.amountCents ?? 3000,
      status: seed.status ?? 'PENDING',
      expiresAt: new Date(now + (seed.expiresInHours ?? 48) * HOUR),
      priceValidUntil:
        seed.priceValidInHours === undefined || seed.priceValidInHours === null
          ? null
          : new Date(now + seed.priceValidInHours * HOUR),
      parentOfferId: seed.parentOfferId ?? null,
      acceptedBelowFloor: true,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    },
    select: { id: true },
  })
  return offer.id
}

// ---------------------------------------------------------------------------
// La portée
// ---------------------------------------------------------------------------

describe('portée du registre', () => {
  it('ne montre que les offres du compte qui lit', async () => {
    const [mine, theirs] = await Promise.all([
      makeUser('moi@registre-offres.test'),
      makeUser('autre@registre-offres.test'),
    ])
    const articleId = await makeArticle('portee')

    await makeOffer({ articleId, userId: mine, amountCents: 3000 })
    await makeOffer({ articleId, userId: theirs, amountCents: 3100 })

    const rows = await listOffers(mine, 'fr')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.amountCents).toBe(3000)
  })

  it('ignore les offres déposées sans compte', async () => {
    // La page n'a rien à saisir : sur un poste partagé, lister par jeton
    // montrerait ce que la personne précédente a négocié, et sur quoi.
    const userId = await makeUser('sanscompte@registre-offres.test')
    const articleId = await makeArticle('invitee')

    await makeOffer({
      articleId,
      guestSessionToken: 'jeton-de-quelquun',
      guestEmail: 'sanscompte@registre-offres.test',
    })

    expect(await listOffers(userId, 'fr')).toEqual([])
  })

  it('ne renvoie rien sur une identité vide', async () => {
    // Une chaîne vide qui traverserait la clause `where` ferait correspondre
    // toute offre dont `userId` vaudrait lui aussi la chaîne vide.
    const articleId = await makeArticle('vide')
    await makeOffer({ articleId, guestSessionToken: 'jeton', guestEmail: 'x@y.z' })

    expect(await listOffers('', 'fr')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Ce qui ne sort jamais
// ---------------------------------------------------------------------------

describe('champs privés', () => {
  it('ne laisse fuiter ni coût, ni plancher, ni note interne', async () => {
    const userId = await makeUser('fuite@registre-offres.test')
    const articleId = await makeArticle('fuite')
    await makeOffer({ articleId, userId, status: 'ACCEPTED', priceValidInHours: 12 })

    const rows = await listOffers(userId, 'fr')
    const serialized = JSON.stringify(rows)

    for (const forbidden of [
      'costCents',
      'floorPriceCents',
      'internalNotes',
      'minOfferCents',
      // La trace d'une vente sous le plancher est une note interne sur une
      // décision commerciale : elle ne regarde pas la personne à qui l'on
      // vient de faire une faveur.
      'acceptedBelowFloor',
      'guestEmail',
      'guestSessionToken',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden)
    }

    // Et les valeurs elles-mêmes, pas seulement les noms de colonnes.
    expect(serialized).not.toContain('2100')
    expect(serialized).not.toContain('900')
  })
})

// ---------------------------------------------------------------------------
// L'état affiché
// ---------------------------------------------------------------------------

describe('état affiché', () => {
  it('dérive « payable » et « validité passée » à l’instant de la lecture', async () => {
    const userId = await makeUser('etat@registre-offres.test')
    const articleId = await makeArticle('etat')

    await makeOffer({
      articleId,
      userId,
      status: 'ACCEPTED',
      priceValidInHours: 6,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    })

    const now = new Date()
    expect((await listOffers(userId, 'fr', { now }))[0]?.standing).toBe('payable')

    // Sept heures plus tard, la même ligne en base ne dit plus la même chose.
    const later = new Date(now.getTime() + 7 * HOUR)
    expect((await listOffers(userId, 'fr', { now: later }))[0]?.standing).toBe(
      'lapsed',
    )
  })

  it('dit « sans réponse » sans attendre le balayage des offres échues', async () => {
    const userId = await makeUser('echue@registre-offres.test')
    const articleId = await makeArticle('echue')

    // PENDING en base, échéance passée : c'est l'état que laisse le temps
    // entre deux passages de la tâche planifiée.
    await makeOffer({ articleId, userId, status: 'PENDING', expiresInHours: -1 })

    const rows = await listOffers(userId, 'fr')
    expect(rows[0]?.standing).toBe('expired')
  })

  it('distingue une contre-proposition de la boutique', async () => {
    const userId = await makeUser('contre@registre-offres.test')
    const articleId = await makeArticle('contre')

    const parentId = await makeOffer({
      articleId,
      userId,
      status: 'COUNTERED',
      amountCents: 3000,
      createdAt: new Date('2026-08-20T10:00:00Z'),
    })
    await makeOffer({
      articleId,
      userId,
      status: 'PENDING',
      amountCents: 3400,
      parentOfferId: parentId,
      createdAt: new Date('2026-08-20T11:00:00Z'),
    })

    const rows = await listOffers(userId, 'fr')

    // La plus récente d'abord : la contre-proposition, qui porte le même
    // compte que l'offre d'origine et que rien d'autre ne distinguerait.
    expect(rows.map((row) => [row.amountCents, row.fromShop])).toEqual([
      [3400, true],
      [3000, false],
    ])
  })
})

// ---------------------------------------------------------------------------
// Ce que la ligne donne à lire
// ---------------------------------------------------------------------------

describe('contenu d’une ligne', () => {
  it('donne le titre dans la langue lue, et le français à défaut', async () => {
    const userId = await makeUser('langue@registre-offres.test')
    const articleId = await makeArticle('langue')
    await makeOffer({ articleId, userId })

    expect((await listOffers(userId, 'en'))[0]?.article.title).toBe('Wool coat')
    expect((await listOffers(userId, 'fr'))[0]?.article.title).toBe(
      'Manteau de laine',
    )
    // Le polonais n'est pas traduit sur cette pièce : le français prend le
    // relais, plutôt qu'une ligne sans titre.
    expect((await listOffers(userId, 'pl'))[0]?.article.title).toBe(
      'Manteau de laine',
    )
  })

  it('retombe sur la référence quand la pièce n’a aucune traduction', async () => {
    const userId = await makeUser('sanstitre@registre-offres.test')
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
    const article = await prisma.article.create({
      data: {
        sku: `${PREFIX}nue`,
        slug: 'registre-offre-nue',
        condition: 'GOOD',
        sizeLabel: 'M',
        sizeNormalized: 'M',
        priceCents: 3800,
        costCents: 900,
        floorPriceCents: 2100,
        weightGrams: 500,
        status: 'AVAILABLE',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        categoryId: category.id,
      },
      select: { id: true },
    })
    await makeOffer({ articleId: article.id, userId })

    expect((await listOffers(userId, 'fr'))[0]?.article.title).toBe(`${PREFIX}nue`)
  })

  it('signale une pièce partie, sans la faire disparaître', async () => {
    // Une offre sur une pièce vendue reste au registre : la personne doit
    // pouvoir comprendre pourquoi sa négociation n'a mené nulle part.
    const userId = await makeUser('vendue@registre-offres.test')
    const articleId = await makeArticle('vendue', { status: 'SOLD' })
    await makeOffer({ articleId, userId, status: 'VOIDED' })

    const rows = await listOffers(userId, 'fr')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.standing).toBe('void')
    expect(rows[0]?.article.isSold).toBe(true)
  })

  it('borne le nombre de lignes ramenées', async () => {
    const userId = await makeUser('beaucoup@registre-offres.test')
    const articleId = await makeArticle('beaucoup')

    for (let index = 0; index < 5; index += 1) {
      await makeOffer({
        articleId,
        userId,
        amountCents: 3000 + index,
        createdAt: new Date(Date.UTC(2026, 7, 20, index)),
      })
    }

    const rows = await listOffers(userId, 'fr', { limit: 3 })
    expect(rows).toHaveLength(3)
    // Les plus récentes, et non les trois premières venues.
    expect(rows.map((row) => row.amountCents)).toEqual([3004, 3003, 3002])
  })
})
