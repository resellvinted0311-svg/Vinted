import { describe, it, expect } from 'vitest'
import { PAGE_PRIVEE, descriptionCourte } from '@/lib/seo/metadata'
import {
  blocSite,
  blocListe,
  blocOrganisation,
} from '@/lib/seo/structured-data'
import { SITE, hasLegalIdentity } from '@/lib/config/site'

/**
 * Les règles de référencement qu'aucun rendu ne signale quand elles cassent.
 *
 * C'est la propriété commune de tout ce fichier : une balise `canonical` qui
 * désigne la mauvaise page, une description absente, un bloc JSON-LD au
 * mauvais format — rien de tout cela ne fait échouer une page. Le site
 * s'affiche parfaitement, et le défaut ne se voit que dans un outil pour
 * webmestres, des semaines plus tard, sur des pages qu'on ne regarde pas.
 */

describe('les métadonnées des pages non indexées', () => {
  it('n’annoncent AUCUNE page canonique', () => {
    /*
      `null`, et pas l'adresse de la page.

      Ces pages héritaient du canonique de la mise en page — celui de
      l'ACCUEIL — et déclaraient donc que /fr/panier et /fr/ sont la même page.
      Le repli à `undefined` ne suffirait pas : c'est justement ce qui laisse
      l'héritage reprendre la main.
    */
    expect(PAGE_PRIVEE.alternates.canonical).toBeNull()
  })

  it('ne publient aucun hreflang', () => {
    // Huit hreflang de l'accueil déclarés depuis le panier rendaient le groupe
    // de langues non réciproque, donc ignoré — pour l'accueil lui-même.
    expect(Object.keys(PAGE_PRIVEE.alternates.languages)).toEqual([])
  })

  it('restent en noindex, nofollow', () => {
    expect(PAGE_PRIVEE.robots).toEqual({ index: false, follow: false })
  })
})

describe('descriptionCourte', () => {
  it('laisse intacte une phrase déjà courte', () => {
    expect(descriptionCourte('Une phrase brève.')).toBe('Une phrase brève.')
  })

  it('coupe au dernier mot entier, jamais au milieu', () => {
    const resultat = descriptionCourte('abcde fghij klmno pqrst', 14)

    expect(resultat).toBe('abcde fghij…')
    expect(resultat.length).toBeLessThanOrEqual(14)
  })

  it('normalise les blancs, retours à la ligne compris', () => {
    // Les descriptions viennent de textes rédigés pour être AFFICHÉS : un
    // retour à la ligne y est légitime, dans un attribut `content` il ne l'est
    // pas.
    expect(descriptionCourte('  deux\n\nlignes  ')).toBe('deux lignes')
  })
})

describe('le bloc WebSite', () => {
  const bloc = blocSite('fr')

  it('décrit une recherche que le site sert réellement', () => {
    // `/fr/catalogue?q=…` est la cible du formulaire de recherche, celle que
    // `parseCatalogueSearchParams` lit. Décrire une recherche inexistante est
    // l'une des rares erreurs de données structurées qu'un moteur vérifie.
    const action = bloc.potentialAction as {
      target: { urlTemplate: string }
      'query-input': string
    }

    expect(action.target.urlTemplate).toBe(
      `${SITE.url}/fr/catalogue?q={search_term_string}`,
    )
    expect(action['query-input']).toBe('required name=search_term_string')
  })

  it('porte la langue de la page, pas celle par défaut', () => {
    expect(blocSite('pl').inLanguage).toBe('pl-PL')
  })
})

describe('le bloc Organization', () => {
  it('n’existe que si l’identité légale est renseignée', () => {
    /*
      Un `Organization` sans nom ni adresse est signalé comme entité
      incomplète, et le signalement porte sur le DOMAINE, pas sur la page. Ne
      rien publier vaut mieux.

      Le test suit l'environnement plutôt que de le forcer : les valeurs
      légales viennent de variables d'environnement, et les figer ici ferait
      passer le test dans une configuration où le code, lui, ne marcherait pas.
    */
    expect(blocOrganisation() === null).toBe(!hasLegalIdentity())
  })
})

describe('le bloc ItemList', () => {
  it('disparaît quand la grille est vide', () => {
    // Une liste sans élément n'est pas « une liste vide » pour un validateur,
    // c'est une donnée structurée invalide.
    expect(blocListe('fr', [])).toBeNull()
  })

  it('numérote à partir de 1, dans l’ordre de la grille', () => {
    const bloc = blocListe('fr', ['une-veste', 'un-pull'])
    const elements = bloc!.itemListElement as {
      position: number
      url: string
    }[]

    expect(elements.map((e) => e.position)).toEqual([1, 2])
    expect(elements[0]!.url).toBe(`${SITE.url}/fr/a/une-veste`)
  })

  it('ne recopie ni prix ni titre', () => {
    /*
      La liste ne porte QUE des adresses. Recopier le prix ici créerait une
      seconde source : le jour où il baisse, le bloc sommaire et le bloc de la
      fiche se contrediraient, et un prix structuré différent du prix affiché
      fait perdre le résultat enrichi de la fiche.
    */
    const bloc = blocListe('fr', ['une-veste'])
    const [element] = bloc!.itemListElement as Record<string, unknown>[]

    expect(Object.keys(element!).sort()).toEqual(['@type', 'position', 'url'])
  })
})
