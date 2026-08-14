import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  acquireStockLocks,
  releaseStockLocks,
  releaseExpiredStockLocks,
} from '@/lib/shop/stock-lock'

/**
 * Verrou de stock, contre une vraie base PostgreSQL.
 *
 * Ces tests ne peuvent pas être unitaires : ce qu'ils vérifient — la
 * sérialisation de deux transactions concurrentes sur la même ligne — est une
 * propriété du moteur, pas du code. Les simuler avec un faux client Prisma
 * reviendrait à tester notre propre imagination de PostgreSQL.
 */

afterAll(async () => {
  await prisma.$disconnect()
})

/** Un article disponible, isolé de ceux du seed. */
async function makeArticle(suffix: string): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({
    select: { id: true },
  })

  const article = await prisma.article.create({
    data: {
      sku: `LOCK-${suffix}`,
      slug: `verrou-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 2000,
      costCents: 500,
      floorPriceCents: 1200,
      weightGrams: 300,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })

  return article.id
}

async function cleanup(): Promise<void> {
  await prisma.article.deleteMany({ where: { sku: { startsWith: 'LOCK-' } } })
}

beforeEach(cleanup)
afterAll(cleanup)

/**
 * Promesse dont on garde la clé.
 *
 * Sert à imposer un ordre entre deux transactions ouvertes en même temps.
 * L'affectation définie (`!`) est nécessaire : TypeScript ne sait pas que
 * l'exécuteur d'une promesse s'exécute de façon synchrone.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const statusOf = async (id: string) =>
  prisma.article.findUniqueOrThrow({
    where: { id },
    select: { status: true, reservedById: true, reservedUntil: true },
  })

describe('exclusion mutuelle', () => {
  it('deux transactions RÉELLEMENT entrelacées : une seule gagne', async () => {
    // LE test de la Phase 2. S'il échoue, la boutique vend deux fois le même
    // vêtement — et il n'y en a qu'un.
    //
    // Lancer dix transactions avec Promise.all ne suffit PAS : mesuré, elles se
    // sérialisent d'elles-mêmes et une implémentation naïve « lire puis
    // écrire » passe le test. On force donc l'entrelacement à la main.
    //
    // Déroulé imposé :
    //   1. A prend le verrou, et NE VALIDE PAS ;
    //   2. B tente sa prise pendant que A est encore ouverte ;
    //   3. A valide ;
    //   4. B doit avoir échoué.
    //
    // Une implémentation naïve lit « AVAILABLE » à l'étape 2 — A n'a rien
    // validé — puis écrit sans condition de statut, et les deux se croient
    // gagnantes. La mise à jour conditionnelle, elle, bloque sur le verrou de
    // ligne de A puis réévalue son WHERE après validation : elle ne touche
    // aucune ligne.
    const articleId = await makeArticle('entrelace')

    const aPrisLeVerrou = deferred()
    const attendreB = deferred()

    const transactionA = prisma.$transaction(
      async (tx) => {
        const result = await acquireStockLocks(tx, {
          articleIds: [articleId],
          ownerId: 'acheteur-A',
          ttlMinutes: 15,
        })
        aPrisLeVerrou.resolve()
        // A reste ouverte, verrou de ligne tenu, le temps que B tente sa
        // chance. C'est ici que se joue la course.
        await attendreB.promise
        return result
      },
      { timeout: 15_000 },
    )

    await aPrisLeVerrou.promise

    const transactionB = prisma
      .$transaction(
        (tx) =>
          acquireStockLocks(tx, {
            articleIds: [articleId],
            ownerId: 'acheteur-B',
            ttlMinutes: 15,
          }),
        { timeout: 15_000 },
      )
      .catch(() => ({ ok: false as const, unavailableArticleIds: [articleId] }))

    // Laisser B atteindre son UPDATE et s'y bloquer avant de libérer A.
    await new Promise((resolve) => setTimeout(resolve, 300))
    attendreB.resolve()

    const [resultatA, resultatB] = await Promise.all([transactionA, transactionB])

    expect(resultatA.ok).toBe(true)
    expect(resultatB.ok).toBe(false)

    const article = await statusOf(articleId)
    expect(article.status).toBe('RESERVED')
    expect(article.reservedById).toBe('acheteur-A')
  })

  it('dix tentatives simultanées ne produisent qu’une gagnante', async () => {
    // Complément du test ci-dessus : celui-ci n'entrelace rien de force, mais
    // il couvre le cas où l'ordonnancement fait vraiment se chevaucher deux
    // transactions. Il ne remplace pas le précédent — seul, il passerait sur
    // une implémentation fausse.
    const articleId = await makeArticle('concurrence')

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        prisma
          .$transaction((tx) =>
            acquireStockLocks(tx, {
              articleIds: [articleId],
              ownerId: `acheteur-${index}`,
              ttlMinutes: 15,
            }),
          )
          .catch(() => ({ ok: false as const, unavailableArticleIds: [articleId] })),
      ),
    )

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect((await statusOf(articleId)).reservedById).toMatch(/^acheteur-\d$/)
  })

  it('deux clics du MÊME acheteur ne créent pas deux verrous vivants', async () => {
    // Double-clic, deux onglets, retour arrière : le verrou consultatif les
    // sérialise, et les deux tentatives décrivent le même verrou.
    const articleId = await makeArticle('double-clic')

    const results = await Promise.all([
      prisma.$transaction((tx) =>
        acquireStockLocks(tx, {
          articleIds: [articleId],
          ownerId: 'acheteur-unique',
          ttlMinutes: 15,
        }),
      ),
      prisma.$transaction((tx) =>
        acquireStockLocks(tx, {
          articleIds: [articleId],
          ownerId: 'acheteur-unique',
          ttlMinutes: 15,
        }),
      ),
    ])

    expect(results.every((result) => result.ok)).toBe(true)

    const article = await statusOf(articleId)
    expect(article.reservedById).toBe('acheteur-unique')
  })
})

describe('tout ou rien', () => {
  it('ne verrouille rien si une seule pièce du panier est déjà prise', async () => {
    // Verrouiller partiellement laisserait payer trois articles sur quatre
    // sans que personne ne l'ait accepté.
    const libre = await makeArticle('libre')
    const pris = await makeArticle('pris')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [pris],
        ownerId: 'premier',
        ttlMinutes: 15,
      }),
    )

    const result = await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [libre, pris],
        ownerId: 'second',
        ttlMinutes: 15,
      }),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.unavailableArticleIds).toEqual([pris])

    // La transaction a été annulée par l'appelant dans la vraie vie ; ici on
    // vérifie surtout que le second n'a pas volé la pièce du premier.
    expect((await statusOf(pris)).reservedById).toBe('premier')
  })

  it('refuse une pièce vendue, même à celui qui l’avait réservée', async () => {
    const articleId = await makeArticle('vendu')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'acheteur',
        ttlMinutes: 15,
      }),
    )
    await prisma.article.update({
      where: { id: articleId },
      data: { status: 'SOLD', soldAt: new Date() },
    })

    const result = await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'acheteur',
        ttlMinutes: 15,
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('refuse une pièce non publiée', async () => {
    const articleId = await makeArticle('brouillon')
    await prisma.article.update({
      where: { id: articleId },
      data: { publishedAt: null },
    })

    const result = await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'acheteur',
        ttlMinutes: 15,
      }),
    )

    expect(result.ok).toBe(false)
  })
})

describe('reprise d’un verrou expiré', () => {
  it('un autre acheteur reprend une réservation échue', async () => {
    const articleId = await makeArticle('expire')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'premier',
        ttlMinutes: 15,
      }),
    )

    // On fait vieillir la réservation plutôt que d'attendre un quart d'heure.
    await prisma.article.update({
      where: { id: articleId },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    })

    const result = await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'second',
        ttlMinutes: 15,
      }),
    )

    expect(result.ok).toBe(true)
    expect((await statusOf(articleId)).reservedById).toBe('second')
  })
})

describe('libération', () => {
  it('ne libère que ses propres verrous', async () => {
    // Sans cette condition, un abandon tardif libérerait le verrou que
    // quelqu'un d'autre vient de prendre — et deux personnes paieraient.
    const articleId = await makeArticle('proprietaire')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'legitime',
        ttlMinutes: 15,
      }),
    )

    const released = await prisma.$transaction((tx) =>
      releaseStockLocks(tx, { articleIds: [articleId], ownerId: 'intrus' }),
    )

    expect(released).toBe(0)
    expect((await statusOf(articleId)).reservedById).toBe('legitime')
  })

  it('libère bien le verrou de son propriétaire', async () => {
    const articleId = await makeArticle('rendu')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'legitime',
        ttlMinutes: 15,
      }),
    )
    await prisma.$transaction((tx) =>
      releaseStockLocks(tx, { articleIds: [articleId], ownerId: 'legitime' }),
    )

    const article = await statusOf(articleId)
    expect(article.status).toBe('AVAILABLE')
    expect(article.reservedById).toBeNull()
    expect(article.reservedUntil).toBeNull()
  })
})

describe('balayage des réservations échues', () => {
  it('libère l’échu et laisse le vivant tranquille', async () => {
    const echu = await makeArticle('echu')
    const vivant = await makeArticle('vivant')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [echu, vivant],
        ownerId: 'acheteur',
        ttlMinutes: 15,
      }),
    )
    await prisma.article.update({
      where: { id: echu },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    })

    await releaseExpiredStockLocks()

    expect((await statusOf(echu)).status).toBe('AVAILABLE')
    expect((await statusOf(vivant)).status).toBe('RESERVED')
  })

  it('ne ressuscite jamais un article vendu', async () => {
    // Son échéance a beau être passée, une vente conclue n'est pas un verrou.
    const articleId = await makeArticle('vendu-echu')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'acheteur',
        ttlMinutes: 15,
      }),
    )
    await prisma.article.update({
      where: { id: articleId },
      data: { status: 'SOLD', soldAt: new Date(), reservedUntil: new Date(0) },
    })

    await releaseExpiredStockLocks()

    expect((await statusOf(articleId)).status).toBe('SOLD')
  })

  it('est idempotent : deux passages, aucun effet supplémentaire', async () => {
    const articleId = await makeArticle('idempotent')

    await prisma.$transaction((tx) =>
      acquireStockLocks(tx, {
        articleIds: [articleId],
        ownerId: 'acheteur',
        ttlMinutes: 15,
      }),
    )
    await prisma.article.update({
      where: { id: articleId },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    })

    expect(await releaseExpiredStockLocks()).toBe(1)
    expect(await releaseExpiredStockLocks()).toBe(0)
  })
})
