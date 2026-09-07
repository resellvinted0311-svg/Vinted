import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db/client'
import { getFacets, type Facets } from '@/lib/db/queries/articles'
import { EMPTY_FILTERS, type CatalogueFilters } from '@/lib/domain/catalogue'

/**
 * Les facettes n'ont pas changé de RÉSULTAT en changeant de forme.
 *
 * ---------------------------------------------------------------------------
 * Ce que cette empreinte capture
 * ---------------------------------------------------------------------------
 * `getFacets` émettait neuf requêtes — sept compteurs, les bornes de prix, et
 * la même sous-requête récursive de catégories répétée dans chacune. Elles
 * sont désormais cousues en UNE seule, par `UNION ALL`.
 *
 * Une réécriture SQL de cette nature se juge sur un seul critère : rend-elle
 * exactement ce que rendait la précédente ? Les compteurs de facettes sont
 * précisément le genre de valeur qu'on ne relit pas — personne ne vérifie que
 * « Levi's 2 » aurait dû afficher 3. Un décalage passerait des mois.
 *
 * L'empreinte a donc été prise sur l'ANCIENNE implémentation, avant la
 * réécriture, et sur neuf combinaisons de filtres choisies pour couvrir ce
 * qui distingue les branches entre elles : une catégorie feuille et une
 * catégorie parente (qui exerce la récursion), une dimension filtrée par
 * elle-même (qui exerce le `skipDimension`), une fourchette de prix, une
 * recherche plein texte.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle ne prétend pas être
 * ---------------------------------------------------------------------------
 * Ce n'est pas une vérification que les compteurs sont JUSTES : c'est une
 * vérification qu'ils n'ont pas bougé. Les deux questions sont distinctes, et
 * celle-ci est la seule que la réécriture pose.
 *
 * L'empreinte dépend du jeu de données semé. Si le seed change, elle doit
 * être reprise — et le message d'échec le dit, pour qu'on ne la « répare »
 * pas en la recopiant sans regarder.
 */

const REFERENCE = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/facettes-reference.json'), 'utf8'),
) as Record<string, Facets>

const CAS: ReadonlyArray<readonly [string, CatalogueFilters]> = [
  ['aucun filtre', EMPTY_FILTERS],
  ['une catégorie', { ...EMPTY_FILTERS, categorySlugs: ['jeans-pantalons'] }],
  ['une catégorie parente', { ...EMPTY_FILTERS, categorySlugs: ['bas'] }],
  ['une marque', { ...EMPTY_FILTERS, brandSlugs: ['levis'] }],
  ['une taille', { ...EMPTY_FILTERS, sizes: ['W30'] }],
  ['un univers', { ...EMPTY_FILTERS, audiences: ['femme', 'mixte'] }],
  ['catégorie + taille', { ...EMPTY_FILTERS, categorySlugs: ['jeans-pantalons'], sizes: ['W30'] }],
  ['une fourchette de prix', { ...EMPTY_FILTERS, minPriceCents: 2000, maxPriceCents: 9000 }],
  ['une recherche', { ...EMPTY_FILTERS, query: 'jean' }],
]

afterAll(async () => {
  await prisma.$disconnect()
})

describe('les facettes, réécrites en une seule requête', () => {
  it('couvre toutes les combinaisons de l’empreinte', () => {
    // Une empreinte amputée rendrait les cas restants verts sans rien prouver.
    expect(Object.keys(REFERENCE).sort()).toEqual(CAS.map(([nom]) => nom).sort())
  })

  it.each(CAS)('rend exactement la même chose — %s', async (nom, filtres) => {
    const obtenu = await getFacets(filtres, 'fr')

    expect(
      obtenu,
      `les facettes de « ${nom} » ont changé. Si le jeu de données semé a ` +
        'été modifié, reprendre tests/fixtures/facettes-reference.json ; ' +
        'sinon, c’est la réécriture SQL qui a dérivé.',
    ).toEqual(REFERENCE[nom])
  })

  it('n’émet qu’UN aller-retour vers la base', async () => {
    /**
     * Le gain tient dans le NOMBRE de requêtes, pas dans leur contenu. Sans ce
     * compteur, une réécriture future pourrait revenir aux neuf requêtes
     * d'origine en gardant tous les tests ci-dessus au vert : ils comparent
     * des résultats, et le résultat, lui, serait identique.
     *
     * Le client est instrumenté puis INJECTÉ dans la fonction. Une première
     * version de ce test comptait les appels sur un client parallèle, que
     * `getFacets` n'utilisait pas : elle aurait été verte quoi qu'il arrive.
     */
    let appels = 0
    const instrumente = {
      $queryRaw: ((...args: Parameters<typeof prisma.$queryRaw>) => {
        appels += 1
        return prisma.$queryRaw(...args)
      }) as typeof prisma.$queryRaw,
    }

    const obtenu = await getFacets(EMPTY_FILTERS, 'fr', instrumente)

    expect(appels, 'les facettes doivent tenir en une seule requête').toBe(1)
    // Et le client injecté doit bien être celui qui a travaillé : un compteur
    // à 1 sur une fonction qui n'aurait rien renvoyé ne prouverait rien.
    expect(obtenu).toEqual(REFERENCE['aucun filtre'])
  })
})
