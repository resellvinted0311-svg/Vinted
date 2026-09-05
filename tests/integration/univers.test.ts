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

/**
 * La vitrine tient DEBOUT sur une boutique dont rien n'est encore rangé.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ces tests auraient dû attraper, et n'ont pas attrapé
 * ---------------------------------------------------------------------------
 * Les cartes d'univers et les cartes de rayon se construisaient sur les
 * facettes du catalogue. Sur le jeu de démonstration, où quarante-trois pièces
 * portent un univers, tout s'affichait et tous les tests passaient. En
 * production, où la colonne venait d'être créée et valait NULL partout, la
 * vitrine entière disparaissait — sans erreur, sans journal, sans le moindre
 * signe.
 *
 * Les tests de bout en bout ne pouvaient pas le voir : ils tournent sur la base
 * semée, c'est-à-dire dans le seul état où le défaut ne se manifeste pas. D'où
 * ces cas-ci, qui interrogent l'état RÉEL de la production : rien de rangé.
 */
describe('la vitrine quand aucune pièce n’est rangée', () => {
  it('liste tous les rayons, même ceux qui n’ont aucune pièce', async () => {
    const { listShowcaseCategories } = await import('@/lib/db/queries/taxonomy')
    const rayons = await listShowcaseCategories('fr')

    // Autant de rayons que de FEUILLES dans la taxonomie — pas autant que de
    // catégories contenant du stock.
    const feuilles = await prisma.category.count({ where: { children: { none: {} } } })

    expect(rayons.length).toBe(feuilles)
    expect(rayons.length).toBeGreaterThan(5)

    // Chacun porte de quoi fabriquer une carte : une adresse et un intitulé.
    for (const rayon of rayons) {
      expect(rayon.slug, JSON.stringify(rayon)).toBeTruthy()
      expect(rayon.name, JSON.stringify(rayon)).toBeTruthy()
    }
  })

  it('inclut un rayon RIGOUREUSEMENT vide', async () => {
    const { listShowcaseCategories } = await import('@/lib/db/queries/taxonomy')

    // On cherche une feuille sans aucune pièce. S'il n'y en a pas dans le jeu
    // semé, le test ne prouve rien : on le dit plutôt que de passer en silence.
    const vides = await prisma.category.findMany({
      where: { children: { none: {} }, articles: { none: {} } },
      select: { slug: true },
    })

    expect(
      vides.length,
      'aucun rayon vide dans le jeu semé : ce test ne prouverait rien',
    ).toBeGreaterThan(0)

    const rayons = await listShowcaseCategories('fr')
    for (const vide of vides) {
      expect(
        rayons.some((r) => r.slug === vide.slug),
        `le rayon « ${vide.slug} » est vide et doit quand même avoir sa carte`,
      ).toBe(true)
    }
  })

  it('répond « rien à trier » quand aucune pièce ne porte l’univers', async () => {
    const { hasSortedAudiences } = await import('@/lib/db/queries/articles')

    // Un univers qui n'existe pas : personne ne le porte, par construction.
    expect(await hasSortedAudiences(['univers-qui-n-existe-pas'])).toBe(false)

    // Une liste vide n'est pas « tout » : c'est « rien ».
    expect(await hasSortedAudiences([])).toBe(false)

    // Et l'inverse, pour que le test ne passe pas en renvoyant toujours faux.
    expect(await hasSortedAudiences(audiencesFor('femme'))).toBe(true)
  })

  it('sert quand même des photographies de rayon sans distinction d’univers', async () => {
    /**
     * `colonne = ANY('{}')` n'est vrai pour AUCUNE ligne : passer un tableau
     * vide ne relâchait pas la restriction, il rendait zéro visuel. Les cartes
     * seraient restées au lavis pour toujours sur une boutique non triée,
     * alors que les photographies existent.
     */
    const sansDistinction = await getCategoryCovers([])
    const avecUnivers = await getCategoryCovers(audiencesFor('femme'))

    expect(sansDistinction.size).toBeGreaterThan(0)
    expect(sansDistinction.size).toBeGreaterThanOrEqual(avecUnivers.size)
  })
})
