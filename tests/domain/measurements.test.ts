import { describe, it, expect } from 'vitest'
import { MEASUREMENT_KEYS } from '@/lib/domain/vocabulary'
import { CATEGORIES } from '@/prisma/seed-data/catalogue'

/**
 * Le vocabulaire de mensurations, et ce qui l'utilise.
 *
 * ---------------------------------------------------------------------------
 * Deux listes se répondent, et rien ne les tenait ensemble
 * ---------------------------------------------------------------------------
 * `MEASUREMENT_KEYS` dit quelles mesures EXISTENT.
 * `Category.measurementKeys` dit lesquelles sont PERTINENTES pour une famille
 * de vêtements — un pantalon n'a pas d'épaules.
 *
 * La seconde est typée `string[]`. Une faute de frappe — `legOpenning`,
 * `footlength` — y passait donc la vérification de types, la migration et le
 * semis. Le seul effet visible arrivait beaucoup plus loin : le formulaire du
 * back-office proposait un champ sans libellé, ou n'en proposait pas alors que
 * la boutiquière l'attendait. Personne ne remonte de là jusqu'à un tableau de
 * données de semis.
 */

describe('le vocabulaire de mensurations', () => {
  it('ne contient aucun doublon', () => {
    expect(new Set(MEASUREMENT_KEYS).size).toBe(MEASUREMENT_KEYS.length)
  })

  it('n’est référencé par aucune catégorie avec une clé inconnue', () => {
    const connues = new Set<string>(MEASUREMENT_KEYS)

    const inconnues = CATEGORIES.flatMap((categorie) =>
      (categorie.measurementKeys ?? [])
        .filter((cle) => !connues.has(cle))
        .map((cle) => `${categorie.slug} → ${cle}`),
    )

    expect(inconnues, 'clés de mesure inconnues du vocabulaire').toEqual([])
  })

  it('est réellement utilisé par les catégories — sinon ce test ne prouve rien', () => {
    // Un garde-fou qui parcourt une liste vide passe toujours.
    const utilisees = new Set(
      CATEGORIES.flatMap((categorie) => categorie.measurementKeys ?? []),
    )
    expect(utilisees.size).toBeGreaterThan(5)
  })

  it('range les mesures de jambe sur les vêtements qui ont des jambes', () => {
    /**
     * `thigh` et `legOpening` sont les deux clés ajoutées avec la convention
     * « à plat ». Elles ne servent à rien tant qu'aucune catégorie ne les
     * réclame : le formulaire du back-office construit ses champs à partir de
     * `Category.measurementKeys`, pas du vocabulaire complet.
     *
     * C'est le mode de panne d'une clé ajoutée à moitié : elle existe, elle
     * est traduite en huit langues, elle est acceptée par le contrat de
     * synchronisation — et personne ne peut la saisir.
     */
    const parSlug = new Map(CATEGORIES.map((c) => [c.slug, c]))

    for (const slug of ['jeans-pantalons', 'shorts']) {
      const cles = parSlug.get(slug)?.measurementKeys ?? []
      expect(cles, slug).toContain('thigh')
      expect(cles, slug).toContain('legOpening')
    }

    // Et pas ailleurs : une largeur de cuisse sur une chemise serait un champ
    // qu'on ne sait pas remplir.
    for (const slug of ['t-shirts', 'chemises', 'chaussures']) {
      const cles = parSlug.get(slug)?.measurementKeys ?? []
      expect(cles, slug).not.toContain('thigh')
      expect(cles, slug).not.toContain('legOpening')
    }
  })

  it('garde l’ordre du corps, de haut en bas', () => {
    /**
     * L'ordre de cette liste EST l'ordre du tableau de la fiche : le composant
     * ne porte plus sa propre copie.
     *
     * Ce test ne vérifie pas un ordre « joli », il vérifie que les repères
     * anatomiques ne se croisent pas — les épaules avant la poitrine, la
     * poitrine avant la taille, la taille avant les hanches. Une insertion
     * distraite au mauvais rang ferait lire le tableau à l'envers, ce qu'aucun
     * autre test ne verrait.
     */
    const rang = (cle: string) => MEASUREMENT_KEYS.indexOf(cle as never)

    expect(rang('shoulders')).toBeLessThan(rang('chest'))
    expect(rang('chest')).toBeLessThan(rang('waist'))
    expect(rang('waist')).toBeLessThan(rang('hips'))
    // Les mesures de jambe se suivent, et la cuisse précède le bas de jambe.
    expect(rang('thigh')).toBeLessThan(rang('legOpening'))
    // La longueur du pied ferme le tableau : c'est le seul repère qui ne
    // concerne pas un vêtement.
    expect(rang('footLength')).toBe(MEASUREMENT_KEYS.length - 1)
  })
})
