import { describe, it, expect } from 'vitest'
import {
  ARTICLE_AUDIENCES,
  audiencesFor,
} from '@/lib/domain/vocabulary'
import {
  EMPTY_FILTERS,
  DEFAULT_SORT,
  hasActiveFilters,
  filtersToSearchParams,
} from '@/lib/domain/catalogue'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'

/**
 * L'univers d'une pièce : Femme, Homme, Mixte.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces tests protègent
 * ---------------------------------------------------------------------------
 * Une dimension de filtre traverse une dizaine d'endroits — la lecture de
 * l'adresse, la structure de filtres, la détection « des filtres sont
 * actifs », la réécriture de l'adresse, la clause SQL, la facette, la
 * pastille. En oublier un ne casse rien : le filtre s'applique simplement à
 * moitié.
 *
 * Le cas le plus vicieux est la réécriture : un filtre absent de
 * `filtersToSearchParams` disparaît au PREMIER clic sur « voir la suite »,
 * alors qu'il fonctionnait parfaitement à l'arrivée sur la page. C'est
 * exactement le défaut que les bornes de prix ont eu, et il avait échappé à
 * tous les tests de fonction isolée.
 */

function rejouer(params: URLSearchParams) {
  const brut: Record<string, string | string[]> = {}
  for (const clef of new Set(params.keys())) {
    const valeurs = params.getAll(clef)
    brut[clef] = valeurs.length > 1 ? valeurs : (valeurs[0] as string)
  }
  return parseCatalogueSearchParams(brut)
}

describe('le vocabulaire des univers', () => {
  it('en compte exactement trois, sans doublon', () => {
    expect(ARTICLE_AUDIENCES).toEqual(['femme', 'homme', 'mixte'])
    expect(new Set(ARTICLE_AUDIENCES).size).toBe(ARTICLE_AUDIENCES.length)
  })

  it('fait tomber les pièces MIXTES dans les deux vitrines', () => {
    /**
     * C'est toute la raison d'être de la troisième valeur. Une chemise
     * oversize n'a pas à être saisie deux fois, ni à disparaître des deux
     * vitrines parce qu'elle n'appartient franchement à aucune.
     */
    expect(audiencesFor('femme')).toEqual(['femme', 'mixte'])
    expect(audiencesFor('homme')).toEqual(['homme', 'mixte'])

    for (const univers of ['femme', 'homme'] as const) {
      expect(audiencesFor(univers)).toContain('mixte')
      // Et pas l'autre : une vitrine qui montrerait les deux ne serait pas une
      // vitrine.
      const autre = univers === 'femme' ? 'homme' : 'femme'
      expect(audiencesFor(univers)).not.toContain(autre)
    }
  })

  it('ne renvoie que des valeurs du vocabulaire', () => {
    // Une valeur hors liste passerait la vérification de types — la fonction
    // renvoie des chaînes — et produirait une clause SQL qui ne correspond à
    // rien : une vitrine vide, sans erreur.
    for (const univers of ['femme', 'homme'] as const) {
      for (const valeur of audiencesFor(univers)) {
        expect(ARTICLE_AUDIENCES).toContain(valeur)
      }
    }
  })
})

describe('le filtre d’univers dans l’adresse', () => {
  it('survit à un aller-retour, deux tours de suite', () => {
    // Le deuxième tour est celui qui compte : c'est lui que produit un clic
    // sur « voir la suite » depuis une vitrine.
    let filtres = { ...EMPTY_FILTERS, audiences: ['femme', 'mixte'] }

    for (let tour = 1; tour <= 2; tour += 1) {
      const relu = rejouer(filtersToSearchParams(filtres, DEFAULT_SORT))
      expect(relu.filters.audiences, `tour ${tour}`).toEqual(['femme', 'mixte'])
      filtres = relu.filters
    }
  })

  it('s’écrit sous le nom « univers », comme les autres paramètres français', () => {
    const params = filtersToSearchParams(
      { ...EMPTY_FILTERS, audiences: ['homme'] },
      DEFAULT_SORT,
    )
    expect(params.getAll('univers')).toEqual(['homme'])
  })

  it('compte comme un filtre actif', () => {
    // Sans cela, le bouton « tout effacer » ne s'affiche pas et le filtre
    // devient impossible à retirer autrement qu'en éditant l'adresse.
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(
      hasActiveFilters({ ...EMPTY_FILTERS, audiences: ['femme'] }),
    ).toBe(true)
  })

  it('ignore une valeur qui n’est pas du vocabulaire', () => {
    // L'adresse est publique : n'importe qui peut y écrire n'importe quoi. Une
    // valeur inconnue ne doit ni lever, ni filtrer sur du vide de façon
    // silencieuse — elle doit disparaître.
    const relu = parseCatalogueSearchParams({ univers: 'FEMME<script>' })
    expect(relu.filters.audiences).toEqual([])
  })
})
