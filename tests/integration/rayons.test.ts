import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  listShowcaseCategories,
  getCategoryByPath,
} from '@/lib/db/queries/taxonomy'

/**
 * Chaque carte de rayon mène quelque part.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier existe pour empêcher
 * ---------------------------------------------------------------------------
 * Les cartes de rayon composaient leur lien avec le seul slug de la
 * catégorie : `/c/t-shirts`. Or la route `/c/[...slug]` vérifie que le chemin
 * annoncé correspond à la hiérarchie réelle et renvoie 404 sinon — une garde
 * légitime, qui empêche deux adresses de servir la même page.
 *
 * « T-shirts » vit sous « Hauts ». Son adresse est donc `/c/hauts/t-shirts`,
 * et la carte pointait vers une page qui n'existe pas. Huit rayons sur quinze
 * étaient dans ce cas — Jeans, T-shirts, Pulls, Chemises, Jupes, Shorts,
 * Manteaux, Vestes légères — c'est-à-dire précisément ceux qu'on ouvre en
 * premier.
 *
 * Ce qui rendait le défaut INVISIBLE : les sept autres rayons sont des
 * feuilles de premier niveau — Robes, Sacs, Chaussures, Accessoires… — pour
 * lesquelles le chemin et le slug sont la même chaîne. La moitié de la
 * vitrine marchait, l'autre menait à un 404, et rien dans le rendu ne
 * distinguait les deux : une carte cassée ressemble trait pour trait à une
 * carte valide.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce test suit le LIEN, et ne compare pas des chaînes
 * ---------------------------------------------------------------------------
 * Vérifier que `path` contient bien un « / » n'aurait rien prouvé : c'est une
 * assertion sur la FORME d'une valeur, alors que le défaut portait sur ce que
 * cette valeur permet de faire. On appelle donc le résolveur que la page
 * appelle, avec le chemin que la carte pose — le trajet exact qu'un visiteur
 * fait en cliquant.
 */

afterAll(async () => {
  await prisma.$disconnect()
})

describe('les cartes de rayon', () => {
  it('portent un chemin que la page de rayon sait résoudre', async () => {
    const rayons = await listShowcaseCategories('fr')

    // Une taxonomie vide rendrait ce test vert sans rien vérifier — le pire
    // des états pour une garde. La base de test est semée : on l'exige.
    expect(rayons.length, 'aucun rayon : base non semée ?').toBeGreaterThan(0)

    const casses: string[] = []

    for (const rayon of rayons) {
      const resolu = await getCategoryByPath(rayon.path, 'fr')
      if (!resolu || resolu.slug !== rayon.slug) {
        casses.push(`${rayon.name} → /c/${rayon.path.join('/')}`)
      }
    }

    expect(
      casses,
      `ces cartes mènent à un 404 :\n  ${casses.join('\n  ')}`,
    ).toEqual([])
  })

  it('couvre bien des rayons IMBRIQUÉS, pas seulement des feuilles de surface', async () => {
    /**
     * Sans cette seconde assertion, le test précédent resterait vert dans le
     * cas même où le défaut se reproduirait : sur une taxonomie entièrement
     * plate, chemin et slug se confondent, et un lien fabriqué avec le slug
     * fonctionnerait par accident.
     *
     * On exige donc que le jeu vérifié contienne au moins un rayon dont le
     * chemin compte plusieurs segments. C'est ce qui rend le test précédent
     * capable d'échouer.
     */
    const rayons = await listShowcaseCategories('fr')
    const imbriques = rayons.filter((rayon) => rayon.path.length > 1)

    expect(
      imbriques.length,
      'aucun rayon imbriqué : le test principal ne prouverait rien',
    ).toBeGreaterThan(0)
  })

  it('donne un chemin qui se termine par le rayon lui-même', async () => {
    // La feuille doit fermer son propre chemin. Un ordre inversé — la racine
    // en dernier — résoudrait aussi longtemps que la hiérarchie n'a que deux
    // niveaux, et casserait au troisième.
    for (const rayon of await listShowcaseCategories('fr')) {
      expect(rayon.path.at(-1)).toBe(rayon.slug)
    }
  })
})
