import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { __resetRateLimitForTests } from '@/lib/security/rate-limit'
import { POST } from '@/app/api/sync/articles/route'

/**
 * La route d'import, appelée comme l'application de gestion l'appellera.
 *
 * Ce qui se joue ici est ce que `lib/sync/articles.ts` ne peut pas montrer :
 * la porte d'entrée, le code de statut d'un lot mixte, et le fait qu'un essai à
 * blanc n'écrit rien même quand il passe par l'URL.
 */

const KEY = 'CLEF-DE-ROUTE-Ai9x3kQm2ZpL'
const PREFIX = 'sync-route-'

function article(index: number, patch: Record<string, unknown> = {}) {
  return {
    externalId: `${PREFIX}${index}`,
    title: `Chemise ${index}`,
    categorySlug: 'chemises',
    condition: 'VERY_GOOD',
    sizeLabel: 'L',
    priceCents: 3800,
    costCents: 900,
    weightGrams: 320,
    images: ['https://images.exemple.fr/a.jpg'],
    ...patch,
  }
}

function post(
  body: unknown,
  { key = KEY, query = '' }: { key?: string | null; query?: string } = {},
): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (key !== null) headers.set('authorization', `Bearer ${key}`)

  return POST(
    new NextRequest(`https://boutique.test/api/sync/articles${query}`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function cleanup(): Promise<void> {
  await prisma.article.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  })
  await prisma.job.deleteMany({ where: { type: 'article.images' } })
}

beforeEach(async () => {
  await cleanup()
  __resetRateLimitForTests()
  vi.stubEnv('SYNC_API_KEY', KEY)
})

afterAll(async () => {
  await cleanup()
  vi.unstubAllEnvs()
})

describe('porte d’entrée', () => {
  it('refuse sans clé', async () => {
    const response = await post([article(1)], { key: null })
    expect(response.status).toBe(401)

    // 401 et non 404 : de l'autre côté, il faut pouvoir distinguer une clé
    // fausse d'une URL fausse.
    expect(await prisma.article.count({ where: { externalId: `${PREFIX}1` } }))
      .toBe(0)
  })

  it('refuse une clé fausse', async () => {
    const response = await post([article(1)], { key: `${KEY}x` })
    expect(response.status).toBe(401)
  })

  it('refuse TOUT quand la clé n’est pas configurée', async () => {
    vi.stubEnv('SYNC_API_KEY', '')
    const response = await post([article(1)], { key: KEY })
    expect(response.status).toBe(401)
  })

  it('ferme au-delà de trente appels par minute', async () => {
    // La route ÉCRIT dans le catalogue : elle est traitée comme un chemin
    // sensible, et le compteur se ferme au lieu de s'ouvrir.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await post([article(attempt)])
      expect(response.status).toBe(200)
    }

    const blocked = await post([article(99)])
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('60')
  })
})

describe('forme du corps', () => {
  it('refuse un corps illisible', async () => {
    const response = await post('{ pas du json')
    expect(response.status).toBe(400)
  })

  it('refuse un lot vide', async () => {
    const response = await post([])
    expect(response.status).toBe(400)
  })

  it('refuse globalement un lot de plus de cent pièces', async () => {
    const response = await post(
      Array.from({ length: 101 }, (_, index) => article(index)),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.reason).toBe('payload-too-large')
    // Pas cent refus identiques : un lot trop grand est un lot mal découpé,
    // pas une collection de pièces invalides.
    expect(body.results).toEqual([])
  })

  it('accepte un article seul, hors tableau', async () => {
    const response = await post(article(1))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.results).toHaveLength(1)
    expect(body.results[0].action).toBe('created')
  })

  it('accepte l’enveloppe { articles: [...] }', async () => {
    const response = await post({ articles: [article(1), article(2)] })
    expect(response.status).toBe(200)
    expect((await response.json()).results).toHaveLength(2)
  })
})

describe('statut d’un lot', () => {
  it('200 quand tout passe', async () => {
    const response = await post([article(1), article(2)])
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })

  it('207 sur un lot mixte, et les bonnes pièces sont écrites', async () => {
    const response = await post([
      article(1),
      article(2, { categorySlug: 'chapeaux' }),
      article(3),
    ])

    // L'objection de l'application était juste : un 422 global sur un lot dont
    // deux pièces sur trois sont passées pousse à tout renvoyer.
    expect(response.status).toBe(207)

    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.results.map((r: { action: string }) => r.action)).toEqual([
      'created',
      'rejected',
      'created',
    ])

    // Une pièce rejetée n'annule pas les autres.
    expect(
      await prisma.article.count({ where: { externalId: { startsWith: PREFIX } } }),
    ).toBe(2)
  })

  it('422 quand tout est rejeté', async () => {
    const response = await post([
      article(1, { categorySlug: 'chapeaux' }),
      article(2, { color: 'bleu-petrole' }),
    ])

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.results[0].reason).toBe('unknown-category')
    expect(body.results[1].reason).toBe('unknown-color')
  })

  it('désigne l’entrée refusée même sans externalId lisible', async () => {
    const response = await post([{ title: 'sans identifiant' }])
    const body = await response.json()

    // Sans ce repli, l'application n'aurait aucun moyen de savoir LAQUELLE de
    // ses cent pièces a été refusée.
    expect(body.results[0].externalId).toBe('#1')
  })
})

describe('essai à blanc', () => {
  it('n’écrit rien avec ?dryRun=1', async () => {
    const response = await post([article(1)], { query: '?dryRun=1' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results[0].action).toBe('would-create')
    expect(body.results[0].floorPriceCents).toBeGreaterThan(0)

    expect(await prisma.article.count({ where: { externalId: `${PREFIX}1` } }))
      .toBe(0)
    expect(await prisma.job.count({ where: { type: 'article.images' } })).toBe(0)
  })

  it('n’écrit rien avec { dryRun: true } à la racine de l’enveloppe', async () => {
    const response = await post({ dryRun: true, articles: [article(1)] })

    expect((await response.json()).results[0].action).toBe('would-create')
    expect(await prisma.article.count({ where: { externalId: `${PREFIX}1` } }))
      .toBe(0)
  })

  it('refuse dryRun glissé à l’intérieur d’un article', async () => {
    // Mélanger une commande et une donnée ouvrirait une brèche dans le refus
    // des clés inconnues : `dryRun` est une clé d'enveloppe, point.
    const response = await post([article(1, { dryRun: true })])

    expect(response.status).toBe(422)
    expect((await response.json()).results[0].reason).toBe('invalid-field')
  })
})
