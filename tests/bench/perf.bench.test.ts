/**
 * Banc d'essai du catalogue — exclu de `pnpm test`, lancé par `pnpm test:bench`.
 *
 * Sert à trancher les choix d'indexation sur mesure plutôt qu'à l'intuition.
 * Il demande une base peuplée : voir la procédure dans le README.
 *
 * Relevé du 12/08/2026, 10 050 articles, PostgreSQL 16 local :
 *
 *   listing page 1 (24 articles)      p50 21,2 ms   p95 25,5 ms
 *   listing tri prix + curseur        p50  9,2 ms   p95 10,0 ms
 *   facettes (6 dimensions)           p50 28,7 ms   p95 33,7 ms
 *   page catalogue complète           p50 32,8 ms   p95 40,6 ms
 *   recherche plein texte             p50 54,0 ms   p95 62,5 ms
 *
 * Conclusion : le comptage direct des facettes tient largement le budget.
 * Une vue matérialisée a été écartée — sur un stock unitaire, des compteurs
 * périmés (« Vestes (3) » alors qu'il n'en reste aucune) coûtent plus cher
 * que 30 ms.
 */
import { listArticles, getFacets } from '@/lib/db/queries/articles'
import { EMPTY_FILTERS } from '@/lib/domain/catalogue'
import { prisma } from '@/lib/db/client'

async function time(label: string, fn: () => Promise<unknown>, runs = 12): Promise<void> {
  await fn() // préchauffage
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint()
    await fn()
    samples.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const p50 = samples[Math.floor(runs * 0.5)]!
  const p95 = samples[Math.floor(runs * 0.95)]!
  console.info(`${label.padEnd(42)} p50 ${p50.toFixed(1)} ms   p95 ${p95.toFixed(1)} ms`)
}

export async function runBench() {
  const total = await prisma.article.count()
  console.info(`Catalogue de ${total} articles\n`)

  await time('listing page 1 (24 articles)', () =>
    listArticles({ filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, locale: 'fr', limit: 24 }))

  await time('listing tri prix', () =>
    listArticles({ filters: EMPTY_FILTERS, sort: 'prix_asc', cursor: null, locale: 'fr', limit: 24 }))

  const deep = await listArticles({ filters: EMPTY_FILTERS, sort: 'prix_asc', cursor: null, locale: 'fr', limit: 24 })
  await time('listing page 2 (curseur)', () =>
    listArticles({ filters: EMPTY_FILTERS, sort: 'prix_asc', cursor: deep.nextCursor, locale: 'fr', limit: 24 }))

  await time('recherche plein texte', () =>
    listArticles({ filters: { ...EMPTY_FILTERS, query: 'coton' }, sort: 'nouveautes', cursor: null, locale: 'fr', limit: 24 }))

  await time('FACETTES (6 dimensions, sans filtre)', () => getFacets(EMPTY_FILTERS, 'fr'))
  await time('FACETTES (filtre marque)', () => getFacets({ ...EMPTY_FILTERS, brandSlugs: ['levis'] }, 'fr'))
  await time('FACETTES (filtre catégorie + état)', () =>
    getFacets({ ...EMPTY_FILTERS, categorySlugs: ['hauts'], conditions: ['GOOD'] }, 'fr'))

  await time('page catalogue complète (listing + facettes)', async () => {
    await Promise.all([
      listArticles({ filters: EMPTY_FILTERS, sort: 'nouveautes', cursor: null, locale: 'fr', limit: 24 }),
      getFacets(EMPTY_FILTERS, 'fr'),
    ])
  })

  await prisma.$disconnect()
}
;

import { it } from 'vitest'
it('mesure les temps de réponse du catalogue', async () => {
  await runBench()
}, 120_000)
