import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { findPrivateFieldLeaks } from '@/lib/db/selectors'
import { EMPTY_FILTERS } from '@/lib/domain/catalogue'
import {
  listArticles,
  getFacets,
  getArticleBySlug,
  getSimilarArticles,
} from '@/lib/db/queries/articles'

/**
 * Tests d'intégration du catalogue, contre une vraie base PostgreSQL.
 *
 * Ils exercent ce qu'un test unitaire ne peut pas atteindre : la recherche
 * plein texte, l'expansion récursive des catégories, et surtout la stabilité
 * de la pagination par curseur — le genre de défaut qui ne se voit qu'avec
 * de vraies données et un vrai plan d'exécution.
 */

afterAll(async () => {
  await prisma.$disconnect()
})

const fr = { locale: 'fr' } as const

describe('listing', () => {
  it('renvoie une première page et un curseur', async () => {
    const page = await listArticles({
      filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, ...fr, limit: 5,
    })

    expect(page.items.length).toBe(5)
    expect(page.totalCount).toBeGreaterThan(5)
    expect(page.nextCursor).not.toBeNull()
  })

  it('n’expose jamais de champ privé', async () => {
    const page = await listArticles({
      filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, ...fr, limit: 24,
    })
    expect(findPrivateFieldLeaks(page.items)).toEqual([])
  })

  it('exclut les brouillons, les programmés et les vendus', async () => {
    const page = await listArticles({
      filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, ...fr, limit: 100,
    })

    for (const article of page.items) {
      expect(['AVAILABLE', 'RESERVED']).toContain(article.status)
      expect(article.publishedAt).not.toBeNull()
    }
  })
})

describe('pagination par curseur', () => {
  // C'est le cœur du sujet : sur un catalogue à stock unitaire, un OFFSET
  // ferait sauter ou dupliquer des articles dès qu'une vente intervient
  // entre deux pages.
  for (const sort of ['nouveautes', 'prix_asc', 'prix_desc'] as const) {
    it(`parcourt tout le catalogue sans doublon ni oubli (tri ${sort})`, async () => {
      const first = await listArticles({
        filters: EMPTY_FILTERS, sort, cursor: null, ...fr, limit: 7,
      })
      const expected = first.totalCount

      const seen = new Set<string>()
      const duplicates: string[] = []
      let cursor: string | null = null
      let pages = 0

      do {
        const page: Awaited<ReturnType<typeof listArticles>> =
          await listArticles({ filters: EMPTY_FILTERS, sort, cursor, ...fr, limit: 7 })

        for (const article of page.items) {
          if (seen.has(article.id)) duplicates.push(article.id)
          seen.add(article.id)
        }
        cursor = page.nextCursor
        pages += 1
      } while (cursor && pages < 50)

      expect(duplicates).toEqual([])
      expect(seen.size).toBe(expected)
    })
  }

  it('respecte l’ordre de tri sur les prix, page après page', async () => {
    const prices: number[] = []
    let cursor: string | null = null
    let pages = 0

    do {
      const page: Awaited<ReturnType<typeof listArticles>> = await listArticles({
        filters: EMPTY_FILTERS, sort: 'prix_asc', cursor, ...fr, limit: 6,
      })
      prices.push(...page.items.map((a) => a.priceCents))
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 50)

    const sorted = [...prices].sort((a, b) => a - b)
    expect(prices).toEqual(sorted)
  })

  it('retombe sur la première page si le curseur est illisible', async () => {
    const page = await listArticles({
      filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: 'n-importe-quoi!!', ...fr, limit: 5,
    })
    expect(page.items.length).toBe(5)
  })
})

describe('recherche', () => {
  it('trouve un mot du titre', async () => {
    const page = await listArticles({
      filters: { ...EMPTY_FILTERS, query: 'chemise' }, sort: 'nouveautes', cursor: null, ...fr, limit: 50,
    })
    expect(page.totalCount).toBeGreaterThan(0)
  })

  it('ignore les accents', async () => {
    // « velours côtelé » et « écru » figurent dans les descriptions du seed :
    // les deux graphies doivent ramener exactement le même ensemble.
    for (const [accented, plain] of [
      ['côtelé', 'cotele'],
      ['écru', 'ecru'],
    ] as const) {
      const withAccent = await listArticles({
        filters: { ...EMPTY_FILTERS, query: accented }, sort: 'nouveautes', cursor: null, ...fr, limit: 100,
      })
      const without = await listArticles({
        filters: { ...EMPTY_FILTERS, query: plain }, sort: 'nouveautes', cursor: null, ...fr, limit: 100,
      })

      expect(withAccent.totalCount, `« ${accented} » ne ramène rien`).toBeGreaterThan(0)
      expect(without.totalCount, `« ${plain} » ≠ « ${accented} »`).toBe(withAccent.totalCount)
    }
  })

  it('tolère un mot tronqué via les trigrammes', async () => {
    const page = await listArticles({
      filters: { ...EMPTY_FILTERS, query: 'chemis' }, sort: 'nouveautes', cursor: null, ...fr, limit: 50,
    })
    expect(page.totalCount).toBeGreaterThan(0)
  })

  it('cherche dans la langue demandée', async () => {
    const dutch = await listArticles({
      filters: { ...EMPTY_FILTERS, query: 'trui' }, sort: 'nouveautes', cursor: null, locale: 'nl', limit: 50,
    })
    expect(dutch.totalCount).toBeGreaterThan(0)
  })
})

describe('filtres', () => {
  it('inclut les sous-catégories d’une catégorie parente', async () => {
    const parent = await listArticles({
      filters: { ...EMPTY_FILTERS, categorySlugs: ['hauts'] }, sort: 'nouveautes', cursor: null, ...fr, limit: 100,
    })
    const child = await listArticles({
      filters: { ...EMPTY_FILTERS, categorySlugs: ['chemises'] }, sort: 'nouveautes', cursor: null, ...fr, limit: 100,
    })

    expect(parent.totalCount).toBeGreaterThan(0)
    // « Hauts » contient chemises, t-shirts et pulls : strictement plus.
    expect(parent.totalCount).toBeGreaterThan(child.totalCount)
  })

  it('borne la fourchette de prix', async () => {
    const page = await listArticles({
      filters: { ...EMPTY_FILTERS, minPriceCents: 2000, maxPriceCents: 3000 },
      sort: 'nouveautes', cursor: null, ...fr, limit: 100,
    })

    for (const article of page.items) {
      expect(article.priceCents).toBeGreaterThanOrEqual(2000)
      expect(article.priceCents).toBeLessThanOrEqual(3000)
    }
  })

  it('combine plusieurs dimensions', async () => {
    const page = await listArticles({
      filters: { ...EMPTY_FILTERS, categorySlugs: ['hauts'], conditions: ['GOOD'] },
      sort: 'nouveautes', cursor: null, ...fr, limit: 100,
    })

    for (const article of page.items) {
      expect(article.condition).toBe('GOOD')
    }
  })
})

describe('facettes', () => {
  it('continue d’afficher les autres marques quand une marque est filtrée', async () => {
    // Sans cette propriété, sélectionner une marque afficherait 0 partout
    // ailleurs et il deviendrait impossible d'en changer sans tout remettre
    // à zéro.
    const facets = await getFacets({ ...EMPTY_FILTERS, brandSlugs: ['levis'] }, 'fr')

    expect(facets.brands.length).toBeGreaterThan(1)
    for (const brand of facets.brands) {
      expect(brand.count).toBeGreaterThan(0)
    }
  })

  it('restreint les autres dimensions au filtre courant', async () => {
    const all = await getFacets(EMPTY_FILTERS, 'fr')
    const filtered = await getFacets({ ...EMPTY_FILTERS, brandSlugs: ['levis'] }, 'fr')

    const totalAll = all.sizes.reduce((sum, entry) => sum + entry.count, 0)
    const totalFiltered = filtered.sizes.reduce((sum, entry) => sum + entry.count, 0)

    expect(totalFiltered).toBeLessThan(totalAll)
  })

  it('libelle les catégories dans la langue demandée', async () => {
    const dutch = await getFacets(EMPTY_FILTERS, 'nl')
    const labels = dutch.categories.map((entry) => entry.label)
    expect(labels.some((label) => /Jeans|Jurken|Truien|Schoenen/.test(label))).toBe(true)
  })

  it('renvoie une fourchette de prix cohérente', async () => {
    const facets = await getFacets(EMPTY_FILTERS, 'fr')
    expect(facets.priceRange).not.toBeNull()
    expect(facets.priceRange!.minCents).toBeLessThanOrEqual(facets.priceRange!.maxCents)
  })
})

describe('fiche article', () => {
  it('renvoie mesures, images et traductions', async () => {
    const page = await listArticles({
      filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, ...fr, limit: 1,
    })
    const article = await getArticleBySlug(page.items[0]!.slug, 'fr')

    expect(article).not.toBeNull()
    expect(article!.images.length).toBeGreaterThan(0)
    expect(article!.translations.length).toBe(8)
    expect(findPrivateFieldLeaks(article)).toEqual([])
  })

  it('garde un article VENDU accessible', async () => {
    // Renvoyer 404 sur une pièce vendue détruirait le référencement acquis.
    const sold = await prisma.article.findFirst({
      where: { status: 'SOLD' },
      select: { slug: true },
    })
    expect(sold).not.toBeNull()

    const article = await getArticleBySlug(sold!.slug, 'fr')
    expect(article).not.toBeNull()
    expect(article!.status).toBe('SOLD')
  })

  it('ne renvoie pas un brouillon', async () => {
    const draft = await prisma.article.findFirst({
      where: { status: 'DRAFT' },
      select: { slug: true },
    })
    expect(draft).not.toBeNull()
    expect(await getArticleBySlug(draft!.slug, 'fr')).toBeNull()
  })

  it('ne renvoie pas un drop encore programmé', async () => {
    const scheduled = await prisma.article.findFirst({
      where: { status: 'SCHEDULED' },
      select: { slug: true },
    })
    expect(scheduled).not.toBeNull()
    expect(await getArticleBySlug(scheduled!.slug, 'fr')).toBeNull()
  })
})

describe('articles similaires', () => {
  it('propose des pièces disponibles, jamais l’article courant', async () => {
    const page = await listArticles({
      filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, ...fr, limit: 1,
    })
    const article = (await getArticleBySlug(page.items[0]!.slug, 'fr'))!

    const similar = await getSimilarArticles(
      {
        excludeId: article.id,
        categoryId: article.category.id,
        brandId: article.brand?.id ?? null,
        sizeNormalized: article.sizeNormalized,
      },
      'fr',
    )

    expect(similar.length).toBeGreaterThan(0)
    expect(similar.map((a) => a.id)).not.toContain(article.id)
    for (const entry of similar) {
      expect(entry.status).toBe('AVAILABLE')
    }
  })
})
