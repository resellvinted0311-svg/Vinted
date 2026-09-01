import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { __resetRateLimitForTests } from '@/lib/security/rate-limit'
import { POST } from '@/app/api/sync/articles/route'
import { empreinte, resteAssezDeTemps } from '@/lib/sync/articles'

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

describe('la garde de temps', () => {
  /**
   * Ce que la garde empêche.
   *
   * Sans elle, la fonction traitait jusqu'à épuisement du temps imparti puis
   * était TUÉE par l'hébergeur : la réponse partait sans corps, et l'appelant
   * recevait un 504 opaque sans savoir combien de pièces étaient passées —
   * alors qu'elles l'étaient réellement, chacune dans sa propre transaction.
   *
   * Le seul recours était de deviner une taille de lot plus petite. Deux
   * imports réels s'y sont arrêtés, à cent puis à vingt-cinq pièces.
   */
  it('annonce TOUJOURS combien de pièces n’ont pas été regardées', async () => {
    // Zéro compris, et c'est le point : un champ qui n'apparaît que lorsqu'il y
    // a un problème est un champ que l'appelant oublie de lire.
    const response = await post({ articles: [article(1), article(2)] })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deferred).toBe(0)
    expect(body.results).toHaveLength(2)
  })

  it('ne reporte rien tant que le budget tient', async () => {
    const response = await post({ articles: [article(3)] })
    const body = await response.json()

    expect(body.deferred).toBe(0)
    expect(body.results.map((r: { action: string }) => r.action)).toEqual([
      'created',
    ])
  })
})

describe('resteAssezDeTemps', () => {
  /**
   * La décision d'entamer une pièce de plus, isolée de l'horloge.
   *
   * Elle vit dans une fonction pure précisément pour être exercée ici sur ses
   * cas limites, plutôt qu'au travers d'un temps truqué qui ne prouverait pas
   * grand-chose.
   */
  it('laisse TOUJOURS passer la première pièce', () => {
    // Sans cette exception, une boutique très lente répondrait « zéro traitée »
    // à chaque appel, et l'appelant renverrait le même lot indéfiniment.
    expect(
      resteAssezDeTemps({
        index: 0,
        ecouleMs: 999_999,
        piecePlusLenteMs: 999_999,
        budgetMs: 45_000,
      }),
    ).toBe(true)
  })

  it('continue tant que la pièce la plus lente tient dans ce qui reste', () => {
    expect(
      resteAssezDeTemps({
        index: 5,
        ecouleMs: 30_000,
        piecePlusLenteMs: 2_000,
        budgetMs: 45_000,
      }),
    ).toBe(true)
  })

  it('s’arrête dès qu’elle n’y tient plus', () => {
    expect(
      resteAssezDeTemps({
        index: 5,
        ecouleMs: 44_000,
        piecePlusLenteMs: 2_000,
        budgetMs: 45_000,
      }),
    ).toBe(false)
  })

  it('accepte le cas où elle tient EXACTEMENT', () => {
    // La borne est inclusive : refuser ici gaspillerait une pièce par lot sans
    // rien protéger.
    expect(
      resteAssezDeTemps({
        index: 3,
        ecouleMs: 43_000,
        piecePlusLenteMs: 2_000,
        budgetMs: 45_000,
      }),
    ).toBe(true)
  })

  it('s’arrête quand le budget est déjà dépassé', () => {
    expect(
      resteAssezDeTemps({
        index: 1,
        ecouleMs: 50_000,
        piecePlusLenteMs: 10,
        budgetMs: 45_000,
      }),
    ).toBe(false)
  })
})

describe('une pièce que l’application n’a pas modifiée', () => {
  /**
   * Le défaut que le court-circuit ferme — et que l'automatisation aurait rendu
   * permanent.
   *
   * `priceCents` était réécrit à CHAQUE passage avec le prix de l'application.
   * Une baisse automatique décidée par la boutique était donc annulée à la
   * synchronisation suivante, sans trace nulle part. Tant qu'on synchronisait à
   * la main, cela passait inaperçu ; toutes les trois heures, la baisse
   * automatique n'aurait tout simplement jamais existé.
   */
  it('n’est pas réécrite au second envoi', async () => {
    const premier = await post({ articles: [article(40)] })
    expect((await premier.json()).results[0].action).toBe('created')

    const second = await post({ articles: [article(40)] })
    const corps = await second.json()

    expect(corps.results[0].action).toBe('unchanged')
    expect(corps.deferred).toBe(0)
  })

  it('conserve un prix BAISSÉ par la boutique', async () => {
    await post({ articles: [article(41)] })

    // La baisse automatique, telle que le cron l'applique : la boutique décide
    // seule, l'application n'en sait rien et continue d'envoyer son prix.
    await prisma.article.update({
      where: { externalId: `${PREFIX}41` },
      data: { priceCents: 2900 },
    })

    await post({ articles: [article(41)] })

    const apres = await prisma.article.findUniqueOrThrow({
      where: { externalId: `${PREFIX}41` },
      select: { priceCents: true },
    })

    // 2900, et non 3800 : sans le court-circuit, le prix de l'application
    // écrasait la baisse à chaque passage.
    expect(apres.priceCents).toBe(2900)
  })

  it('EST réécrite dès que l’application change quelque chose', async () => {
    await post({ articles: [article(42)] })

    const second = await post({ articles: [article(42, { priceCents: 4200 })] })
    const corps = await second.json()
    expect(corps.results[0].action).toBe('updated')

    const apres = await prisma.article.findUniqueOrThrow({
      where: { externalId: `${PREFIX}42` },
      select: { priceCents: true },
    })
    expect(apres.priceCents).toBe(4200)
  })

  it('EST réécrite quand l’application la retire de la vente', async () => {
    // Le cas qui compte pour la boutiquière : une pièce vendue ailleurs doit
    // disparaître du catalogue, même si tout le reste est identique.
    await post({ articles: [article(43)] })

    const second = await post({
      articles: [article(43, { status: 'ARCHIVED' })],
    })
    expect((await second.json()).results[0].action).toBe('updated')

    const apres = await prisma.article.findUniqueOrThrow({
      where: { externalId: `${PREFIX}43` },
      select: { status: true },
    })
    expect(apres.status).toBe('ARCHIVED')
  })
})

describe('l’empreinte', () => {
  const base = {
    externalId: 'x-1',
    title: 'Chemise',
    categorySlug: 'chemises',
    condition: 'VERY_GOOD' as const,
    sizeLabel: 'L',
    priceCents: 3800,
    costCents: 900,
    images: [],
  }

  it('ne dépend PAS de l’ordre des clés', () => {
    /**
     * `JSON.stringify` suit l'ordre d'insertion. Sans tri, deux envois
     * identiques sérialisés dans deux ordres différents donneraient deux
     * empreintes différentes — la pièce serait réécrite à chaque passage, et la
     * protection ne protégerait rien sans que rien ne le montre.
     */
    const a = empreinte({ ...base } as never, 320)
    const b = empreinte(
      {
        images: [],
        costCents: 900,
        priceCents: 3800,
        sizeLabel: 'L',
        condition: 'VERY_GOOD',
        categorySlug: 'chemises',
        title: 'Chemise',
        externalId: 'x-1',
      } as never,
      320,
    )

    expect(a).toBe(b)
  })

  it('change dès qu’une valeur change', () => {
    expect(empreinte({ ...base } as never, 320)).not.toBe(
      empreinte({ ...base, priceCents: 3900 } as never, 320),
    )
  })

  it('change quand le POIDS RÉSOLU change, à envoi identique', () => {
    // Une pièce sans poids prend celui de sa catégorie. Changer ce défaut doit
    // provoquer une réécriture : le poids décide du palier transporteur, donc
    // du prix plancher.
    expect(empreinte({ ...base } as never, 320)).not.toBe(
      empreinte({ ...base } as never, 700),
    )
  })
})
