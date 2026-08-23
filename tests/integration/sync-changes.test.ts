import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { findPrivateFieldLeaks } from '@/lib/db/selectors'
import { __resetRateLimitForTests } from '@/lib/security/rate-limit'
import { GET } from '@/app/api/sync/changes/route'

/**
 * Le filet de rattrapage, contre une vraie base.
 *
 * Ce qu'il doit garantir : une application restée éteinte une semaine rattrape
 * TOUT, sans rien recevoir deux fois et sans rien sauter. Ces deux propriétés
 * se jouent sur la pagination, et elles ne se vérifient qu'avec de vraies
 * lignes — en particulier des lignes modifiées à la même milliseconde, ce que
 * produit tout import par lot.
 */

const KEY = 'CLEF-CHANGES-Ai9x3kQm2ZpL'
const PREFIX = 'SYNCCHG-'

/** Ancre fixe : les tests comparent des fenêtres, pas des durées. */
const ANCHOR = new Date('2026-08-01T00:00:00.000Z')

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { type: 'article.images' } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

async function makeArticle(
  suffix: string,
  options: { externalId?: string | null; updatedAt?: Date } = {},
): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({
    select: { id: true },
  })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `syncchg-${suffix}`,
      externalId:
        options.externalId === undefined
          ? `${PREFIX}ext-${suffix}`
          : options.externalId,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 3800,
      costCents: 900,
      floorPriceCents: 2340,
      weightGrams: 320,
      status: 'AVAILABLE',
      publishedAt: ANCHOR,
      categoryId: category.id,
    },
    select: { id: true },
  })

  if (options.updatedAt) {
    // `updatedAt` est géré par Prisma : seule une écriture brute permet de le
    // placer où le test en a besoin.
    await prisma.$executeRaw`
      UPDATE "Article" SET "updatedAt" = ${options.updatedAt} WHERE "id" = ${article.id}
    `
  }

  return article.id
}

function get(
  query: string,
  { key = KEY }: { key?: string | null } = {},
): Promise<Response> {
  const headers = new Headers()
  if (key !== null) headers.set('authorization', `Bearer ${key}`)

  return GET(
    new NextRequest(`https://boutique.test/api/sync/changes${query}`, {
      method: 'GET',
      headers,
    }),
  )
}

beforeEach(async () => {
  await cleanup()
  __resetRateLimitForTests()
  vi.stubEnv('SYNC_API_KEY', KEY)
})

afterAll(async () => {
  await cleanup()
  vi.unstubAllEnvs()
  await prisma.$disconnect()
})

describe('porte d’entrée', () => {
  it('refuse sans clé, et avec une clé fausse', async () => {
    expect((await get('?since=2026-01-01T00:00:00Z', { key: null })).status).toBe(401)
    expect(
      (await get('?since=2026-01-01T00:00:00Z', { key: `${KEY}x` })).status,
    ).toBe(401)
  })

  it('exige une date lisible', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('?since=avant-hier')).status).toBe(400)
  })

  it('refuse une taille de page aberrante', async () => {
    expect((await get('?since=2026-01-01T00:00:00Z&limit=0')).status).toBe(400)
    expect((await get('?since=2026-01-01T00:00:00Z&limit=5000')).status).toBe(400)
    expect((await get('?since=2026-01-01T00:00:00Z&limit=abc')).status).toBe(400)
  })
})

describe('contenu', () => {
  it('ne rend que les pièces connues de l’application', async () => {
    await makeArticle('c1', { updatedAt: new Date('2026-08-10T00:00:00Z') })
    await makeArticle('c2', {
      externalId: null,
      updatedAt: new Date('2026-08-10T00:00:00Z'),
    })

    const body = (await (await get('?since=2026-08-01T00:00:00Z')).json()) as {
      changes: { sku: string }[]
    }

    const skus = body.changes.map((change) => change.sku)
    expect(skus).toContain(`${PREFIX}c1`)
    // Une pièce née en back-office n'a pas d'`externalId` : l'annoncer à
    // l'application lui parlerait d'un inventaire qui n'est pas le sien.
    expect(skus).not.toContain(`${PREFIX}c2`)
  })

  it('ne laisse fuir aucun champ privé', async () => {
    await makeArticle('c3', { updatedAt: new Date('2026-08-10T00:00:00Z') })

    const body = await (await get('?since=2026-08-01T00:00:00Z')).json()

    // Le prix d'achat, le plancher et le propriétaire du verrou n'ont rien à
    // faire dans un flux d'inventaire — le dernier permettrait de suivre un
    // panier en cours de constitution depuis l'extérieur.
    expect(findPrivateFieldLeaks(body)).toEqual([])
  })

  it('signale une fiche restée sans visuel, avec le motif', async () => {
    const articleId = await makeArticle('c4', {
      updatedAt: new Date('2026-08-10T00:00:00Z'),
    })

    await prisma.job.create({
      data: {
        type: 'article.images',
        payload: { articleId, urls: ['https://images.exemple.fr/a.jpg'] },
        runAt: new Date(),
        attempts: 6,
        lastError: 'Aucun visuel récupéré : la fiche reste en brouillon',
      },
    })

    const body = (await (await get('?since=2026-08-01T00:00:00Z')).json()) as {
      changes: { sku: string; imagesPending: boolean; imagesError: string | null }[]
    }

    const change = body.changes.find((row) => row.sku === `${PREFIX}c4`)

    // Sans cela, l'application croirait la pièce en ligne : son import a bien
    // répondu « created », et rien d'autre ne lui dirait le contraire.
    expect(change?.imagesPending).toBe(true)
    expect(change?.imagesError).toContain('brouillon')
  })

  it('ne rend rien avant la date demandée', async () => {
    await makeArticle('c5', { updatedAt: new Date('2026-07-01T00:00:00Z') })

    const body = (await (await get('?since=2026-08-01T00:00:00Z')).json()) as {
      changes: { sku: string }[]
    }

    expect(body.changes.map((change) => change.sku)).not.toContain(
      `${PREFIX}c5`,
    )
  })
})

describe('pagination', () => {
  /** Trois pièces modifiées à la MÊME milliseconde, comme un import par lot. */
  async function makeTie(): Promise<void> {
    const at = new Date('2026-08-12T09:00:00.000Z')
    for (const suffix of ['p1', 'p2', 'p3']) {
      await makeArticle(suffix, { updatedAt: at })
    }
  }

  it('rattrape tout sans doublon, même à horodatage identique', async () => {
    await makeTie()

    const collected: string[] = []
    let query = '?since=2026-08-01T00:00:00Z&limit=2'

    for (let page = 0; page < 5; page += 1) {
      const body = (await (await get(query)).json()) as {
        changes: { externalId: string }[]
        nextSince: string
        nextAfter: string | null
        hasMore: boolean
      }

      collected.push(...body.changes.map((change) => change.externalId))
      if (!body.hasMore) break

      query =
        `?since=${encodeURIComponent(body.nextSince)}` +
        `&after=${encodeURIComponent(body.nextAfter ?? '')}&limit=2`
    }

    const ours = collected.filter((id) => id.startsWith(`${PREFIX}ext-p`))

    // Ni doublon — l'application réécrirait deux fois le même état — ni trou :
    // un curseur sur la seule date sauterait les lignes de la même
    // milliseconde tombées après la coupure, et personne ne le verrait.
    expect(new Set(ours).size).toBe(ours.length)
    expect(ours.sort()).toEqual([
      `${PREFIX}ext-p1`,
      `${PREFIX}ext-p2`,
      `${PREFIX}ext-p3`,
    ])
  })

  it('annonce qu’il reste des pages', async () => {
    await makeTie()

    const body = (await (
      await get('?since=2026-08-01T00:00:00Z&limit=1')
    ).json()) as { changes: unknown[]; hasMore: boolean; nextAfter: string | null }

    expect(body.changes).toHaveLength(1)
    expect(body.hasMore).toBe(true)
    expect(body.nextAfter).not.toBeNull()
  })

  it('sur une page vide, renvoie la date demandée plutôt que « maintenant »', async () => {
    const body = (await (
      await get('?since=2030-01-01T00:00:00Z')
    ).json()) as { changes: unknown[]; nextSince: string }

    // Avancer le curseur à l'heure courante ferait sauter tout ce qui a été
    // modifié entre-temps, et cela ne se verrait jamais.
    expect(body.changes).toHaveLength(0)
    expect(body.nextSince).toBe('2030-01-01T00:00:00.000Z')
  })
})
