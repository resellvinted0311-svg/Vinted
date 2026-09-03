import { describe, it, expect } from 'vitest'
import {
  filtersToSearchParams,
  EMPTY_FILTERS,
  DEFAULT_SORT,
  type CatalogueFilters,
} from '@/lib/domain/catalogue'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'

/**
 * L'URL du catalogue doit se relire elle-même.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ces tests ont attrapé
 * ---------------------------------------------------------------------------
 * Deux fonctions se répondent : `parseCatalogueSearchParams` LIT l'adresse,
 * `filtersToSearchParams` la RÉÉCRIT — pour le bouton « voir la suite », pour
 * les liens de retrait d'une pastille de filtre, et pour l'action serveur qui
 * charge le lot suivant.
 *
 * Elles ne parlaient pas la même unité. L'adresse porte des EUROS, parce
 * qu'elle se lit, se partage et s'écrit à la main ; le domaine raisonne en
 * CENTIMES. La lecture convertissait, l'écriture non : elle recopiait les
 * centimes tels quels.
 *
 * Un filtre « moins de 20 € » produisait donc `prix_max=20`, relu 2 000
 * centimes, puis réécrit `prix_max=2000` — relu 200 000 centimes au coup
 * suivant. Le filtre de prix ne disparaissait pas : il devenait simplement si
 * large qu'il ne filtrait plus rien. On voyait des pièces à 80 € dans une
 * recherche à moins de 20, après avoir cliqué sur « voir la suite ».
 *
 * Rien ne pouvait le signaler. Les deux fonctions sont correctes prises
 * séparément ; c'est leur ACCORD qui manquait, et un aller-retour est la seule
 * façon de le vérifier.
 */

function rejouer(params: URLSearchParams) {
  // `parseCatalogueSearchParams` attend la forme que Next passe à une page :
  // une valeur ou un tableau de valeurs par clé.
  const brut: Record<string, string | string[]> = {}
  for (const clef of new Set(params.keys())) {
    const valeurs = params.getAll(clef)
    brut[clef] = valeurs.length > 1 ? valeurs : (valeurs[0] as string)
  }
  return parseCatalogueSearchParams(brut)
}

describe('l’aller-retour de l’adresse du catalogue', () => {
  it('conserve une borne de prix haute', () => {
    const depart = { ...EMPTY_FILTERS, maxPriceCents: 2000 }

    const premier = rejouer(filtersToSearchParams(depart, DEFAULT_SORT))
    expect(
      premier.filters.maxPriceCents,
      'la borne haute a changé de valeur au premier aller-retour',
    ).toBe(2000)

    // Le deuxième tour est celui qui compte : c'est lui que produit un clic sur
    // « voir la suite » depuis une page déjà filtrée.
    const second = rejouer(filtersToSearchParams(premier.filters, DEFAULT_SORT))
    expect(second.filters.maxPriceCents).toBe(2000)
  })

  it('conserve une borne de prix basse', () => {
    const depart = { ...EMPTY_FILTERS, minPriceCents: 1500 }
    const tour = rejouer(filtersToSearchParams(depart, DEFAULT_SORT))
    expect(tour.filters.minPriceCents).toBe(1500)
  })

  it('conserve un intervalle complet, deux tours de suite', () => {
    const depart: CatalogueFilters = {
      ...EMPTY_FILTERS,
      minPriceCents: 1000,
      maxPriceCents: 4550,
    }

    let filtres: CatalogueFilters = depart
    for (let tour = 1; tour <= 2; tour += 1) {
      const relu = rejouer(filtersToSearchParams(filtres, DEFAULT_SORT))
      expect(relu.filters.minPriceCents, `tour ${tour}`).toBe(1000)
      expect(relu.filters.maxPriceCents, `tour ${tour}`).toBe(4550)
      filtres = relu.filters
    }
  })

  it('écrit bien des EUROS dans l’adresse, pas des centimes', () => {
    // L'unité de l'adresse n'est pas un détail interne : elle est visible,
    // partagée, et parfois saisie à la main. « prix_max=20 » se comprend,
    // « prix_max=2000 » se lit comme deux mille euros.
    const params = filtersToSearchParams(
      { ...EMPTY_FILTERS, minPriceCents: 1500, maxPriceCents: 2000 },
      DEFAULT_SORT,
    )

    expect(params.get('prix_min')).toBe('15')
    expect(params.get('prix_max')).toBe('20')
  })

  it('conserve les dimensions non monétaires', () => {
    // Garde-fou de portée : si un jour quelqu'un « corrige » l'unité en
    // touchant à la boucle, ces dimensions doivent rester intactes.
    const depart = {
      ...EMPTY_FILTERS,
      categorySlugs: ['robes'],
      brandSlugs: ['levis'],
      sizes: ['S', 'M'],
      query: 'chemise',
    }

    const relu = rejouer(filtersToSearchParams(depart, DEFAULT_SORT))
    expect(relu.filters.categorySlugs).toEqual(['robes'])
    expect(relu.filters.brandSlugs).toEqual(['levis'])
    // Triées, et c'est voulu : deux sélections identiques faites dans un ordre
    // différent doivent produire la MÊME adresse, sinon elles se partagent
    // comme deux pages distinctes et se mettent en cache deux fois.
    expect(relu.filters.sizes).toEqual(['M', 'S'])
    expect(relu.filters.query).toBe('chemise')
  })
})
