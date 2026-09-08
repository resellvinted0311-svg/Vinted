import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CATEGORY_BANNERS,
  bannerFor,
} from '@/lib/design/category-banners'

/**
 * Chaque photographie de bandeau déclarée existe vraiment.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier empêche
 * ---------------------------------------------------------------------------
 * Une entrée qui pointe vers un fichier absent ne produit AUCUNE erreur : ni à
 * la compilation, ni au build, ni au rendu. Le navigateur demande l'image,
 * reçoit un 404, et n'affiche rien — le bandeau garde son lavis, exactement
 * comme un rayon qui n'aurait pas encore de photographie.
 *
 * Les deux états sont donc indiscernables à l'œil : « pas encore d'image » et
 * « image déclarée mais introuvable » se ressemblent trait pour trait. C'est
 * la signature du genre de défaut qui vit des mois — il faut soupçonner
 * quelque chose pour aller vérifier.
 *
 * Une faute de frappe dans un nom de fichier, un tiret oublié, une extension
 * `.jpeg` là où le fichier est en `.jpg`, un fichier ajouté au Finder mais
 * jamais versionné : tout cela échoue ici, bruyamment.
 */

const PUBLIC = join(process.cwd(), 'public')

describe('les bandeaux de rayon', () => {
  const entrees = Object.entries(CATEGORY_BANNERS)

  it.each(entrees.length > 0 ? entrees : [['(aucun)', null] as const])(
    'le fichier déclaré pour « %s » est présent dans public/',
    (slug, bandeau) => {
      if (bandeau === null) {
        // Aucun bandeau déclaré : rien à vérifier, et on le DIT plutôt que de
        // laisser un `it.each` vide passer pour une vérification.
        expect(entrees).toHaveLength(0)
        return
      }

      const chemin = join(PUBLIC, bandeau.src)
      expect(
        existsSync(chemin),
        `« ${slug} » déclare ${bandeau.src}, absent de public/. ` +
          'Le fichier a-t-il été versionné, ou seulement déposé dans le dossier local ?',
      ).toBe(true)
    },
  )

  it('déclare des chemins publics, pas des chemins de fichier', () => {
    for (const [slug, bandeau] of entrees) {
      expect(bandeau.src.startsWith('/'), `${slug} : ${bandeau.src}`).toBe(true)
      expect(
        bandeau.src.startsWith('/public/'),
        `${slug} : « /public/ » ne fait pas partie de l’adresse servie`,
      ).toBe(false)
    }
  })

  it('n’emploie que des formats qu’un navigateur sait afficher', () => {
    // HEIC est le format par défaut d'un iPhone, et aucun navigateur de bureau
    // ne l'affiche. Une photographie glissée telle quelle depuis un téléphone
    // donnerait un cadre vide, sans erreur.
    for (const [slug, bandeau] of entrees) {
      expect(
        /\.(jpe?g|png|webp|avif)$/i.test(bandeau.src),
        `${slug} : ${bandeau.src} n’est pas un format web (jpg, png, webp, avif)`,
      ).toBe(true)
    }
  })

  it('rend null pour un rayon sans photographie', () => {
    expect(bannerFor('rayon-qui-n-existe-pas')).toBeNull()
  })
})
