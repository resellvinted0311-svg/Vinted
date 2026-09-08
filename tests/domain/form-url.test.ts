import { describe, it, expect } from 'vitest'
import { formGetUrl } from '@/lib/utils/form-url'

/**
 * L'adresse produite côté client doit être celle qu'aurait produite le
 * navigateur.
 *
 * ---------------------------------------------------------------------------
 * Ce que cet écart coûterait s'il existait
 * ---------------------------------------------------------------------------
 * Le panneau de filtres suit deux chemins selon que JavaScript est là ou non :
 * soumission native, ou navigation par le routeur. S'ils composaient des
 * adresses différentes pour la même sélection — l'un gardant `prix_min=` vide,
 * l'autre le retirant — on obtiendrait deux adresses pour un seul écran : deux
 * entrées de cache, deux pages indexables, et un lien partagé qui ne montre
 * pas ce que la personne avait sous les yeux.
 *
 * Rien ne casserait, et personne ne le remarquerait. C'est exactement pour ce
 * genre d'écart qu'on écrit un test.
 */
describe('l’adresse d’un formulaire GET', () => {
  it('reprend l’ordre et les doublons, comme le ferait le navigateur', () => {
    // Deux tailles cochées produisent DEUX paramètres du même nom : c'est ce
    // que fait un navigateur, et ce que le validateur attend en face.
    expect(
      formGetUrl('/fr/catalogue', [
        ['tri', 'nouveautes'],
        ['taille', 'W30'],
        ['taille', 'W32'],
      ]),
    ).toBe('/fr/catalogue?tri=nouveautes&taille=W30&taille=W32')
  })

  it('transmet les champs VIDES, parce qu’un navigateur les transmet', () => {
    // Les tentations sont fortes de « nettoyer » ici. Ce serait s'écarter du
    // chemin sans JavaScript, et fabriquer la divergence qu'on veut éviter.
    expect(
      formGetUrl('/fr/catalogue', [
        ['prix_min', ''],
        ['prix_max', ''],
      ]),
    ).toBe('/fr/catalogue?prix_min=&prix_max=')
  })

  it('n’ajoute pas de point d’interrogation quand il n’y a rien à passer', () => {
    expect(formGetUrl('/fr/catalogue', [])).toBe('/fr/catalogue')
  })

  it('échappe ce qui doit l’être', () => {
    expect(formGetUrl('/fr/catalogue', [['q', 'robe été & lin']])).toBe(
      '/fr/catalogue?q=robe+%C3%A9t%C3%A9+%26+lin',
    )
  })

  it('écarte un fichier, qu’une requête GET ne saurait porter', () => {
    const fichier = new File(['x'], 'photo.jpg')
    expect(formGetUrl('/fr/catalogue', [['q', 'jean'], ['piece', fichier]])).toBe(
      '/fr/catalogue?q=jean',
    )
  })
})
