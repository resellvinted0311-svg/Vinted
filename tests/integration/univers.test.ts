import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { getFacets, getCategoryCovers } from '@/lib/db/queries/articles'
import { EMPTY_FILTERS } from '@/lib/domain/catalogue'
import { audiencesFor } from '@/lib/domain/vocabulary'
import { listArticles } from '@/lib/db/queries/articles'

/**
 * Les deux vitrines d'univers, contre la vraie base.
 *
 * ---------------------------------------------------------------------------
 * Ce qui ne peut se vérifier qu'ici
 * ---------------------------------------------------------------------------
 * Le filtre d'univers finit en clause SQL, et une clause SQL sur une colonne
 * NULLABLE a un comportement qu'aucun test de fonction pure ne montre :
 * `audience = ANY(...)` est FAUX pour une ligne dont l'univers est nul — ce
 * n'est ni vrai ni une erreur, c'est faux. C'est exactement ce qu'on veut, et
 * c'est aussi le genre de règle qu'une réécriture innocente de la clause
 * inverserait sans rien casser d'autre.
 */

afterAll(async () => {
  await prisma.$disconnect()
})

describe('les vitrines d’univers', () => {
  it('ne montrent que des pièces de leur univers, ou mixtes', async () => {
    for (const univers of ['femme', 'homme'] as const) {
      const page = await listArticles({
        filters: { ...EMPTY_FILTERS, audiences: audiencesFor(univers) },
        sort: 'nouveautes',
        cursor: null,
        locale: 'fr',
      })

      expect(page.items.length, univers).toBeGreaterThan(0)

      const ids = page.items.map((article) => article.id)
      const lignes = await prisma.article.findMany({
        where: { id: { in: ids } },
        select: { slug: true, audience: true },
      })

      for (const ligne of lignes) {
        expect([univers, 'mixte'], `${ligne.slug} sur /${univers}`).toContain(
          ligne.audience,
        )
      }
    }
  })

  it('laissent DEHORS les pièces non qualifiées, sans les faire disparaître du catalogue', async () => {
    /**
     * Le cas de la migration : la colonne existe, aucune ligne ne la porte, et
     * l'application de gestion ne l'envoie pas. Une pièce non qualifiée doit
     * rester trouvable — sinon la mise en ligne de la fonctionnalité ferait
     * disparaître du stock — mais elle n'a sa place dans aucune vitrine.
     */
    const nonQualifiee = await prisma.article.findFirst({
      where: {
        audience: null,
        status: 'AVAILABLE',
        publishedAt: { not: null, lte: new Date() },
      },
      select: { id: true, slug: true },
    })

    expect(
      nonQualifiee,
      'le jeu de démonstration doit contenir au moins une pièce non qualifiée',
    ).not.toBeNull()

    for (const univers of ['femme', 'homme'] as const) {
      const page = await listArticles({
        filters: { ...EMPTY_FILTERS, audiences: audiencesFor(univers) },
        sort: 'nouveautes',
        cursor: null,
        locale: 'fr',
      })
      expect(page.items.map((a) => a.id)).not.toContain(nonQualifiee!.id)
    }

    // Et elle est bien au catalogue, sans filtre.
    const catalogue = await listArticles({
      filters: EMPTY_FILTERS,
      sort: 'nouveautes',
      cursor: null,
      locale: 'fr',
    })
    expect(catalogue.totalCount).toBeGreaterThan(0)
    const auCatalogue = await prisma.article.count({
      where: {
        id: nonQualifiee!.id,
        status: { in: ['AVAILABLE', 'RESERVED'] },
      },
    })
    expect(auCatalogue).toBe(1)
  })

  it('comptent la même chose que la carte de la vitrine', async () => {
    /**
     * La carte annonce « femme + mixte ». Si elle annonçait le seul effectif
     * de « femme », elle promettrait vingt-sept pièces et en montrerait
     * vingt-huit — un écart minuscule, qui suffit à ne plus croire aucun
     * nombre du site.
     */
    const facettes = await getFacets(EMPTY_FILTERS, 'fr')
    const compte = (valeur: string) =>
      facettes.audiences.find((entry) => entry.value === valeur)?.count ?? 0

    for (const univers of ['femme', 'homme'] as const) {
      const annonce = compte(univers) + compte('mixte')

      const page = await listArticles({
        filters: { ...EMPTY_FILTERS, audiences: audiencesFor(univers) },
        sort: 'nouveautes',
        cursor: null,
        locale: 'fr',
      })

      expect(page.totalCount, `carte ${univers}`).toBe(annonce)
    }
  })

  it('proposent des catégories qui contiennent réellement des pièces de l’univers', async () => {
    const facettes = await getFacets(
      { ...EMPTY_FILTERS, audiences: audiencesFor('femme') },
      'fr',
    )

    expect(facettes.categories.length).toBeGreaterThan(0)

    for (const entree of facettes.categories) {
      const reel = await prisma.article.count({
        where: {
          category: { slug: entree.value },
          audience: { in: audiencesFor('femme') },
          status: { in: ['AVAILABLE', 'RESERVED'] },
          publishedAt: { not: null, lte: new Date() },
        },
      })
      expect(reel, `catégorie ${entree.value}`).toBe(entree.count)
    }
  })

  it('n’illustre une catégorie qu’avec une pièce de cet univers', async () => {
    // La couverture est la photo de la dernière pièce entrée. Prise sans
    // filtrer sur l'univers, la vitrine Homme s'illustrerait de robes.
    const covers = await getCategoryCovers(audiencesFor('homme'))

    for (const [slug, image] of covers) {
      const correspond = await prisma.articleImage.count({
        where: {
          url: image.url,
          article: {
            category: { slug },
            audience: { in: audiencesFor('homme') },
          },
        },
      })
      expect(correspond, `couverture de ${slug}`).toBeGreaterThan(0)
    }
  })
})
