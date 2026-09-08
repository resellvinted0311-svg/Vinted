import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  CATEGORY_BANNERS,
  CATEGORY_CARDS,
  bannerFor,
  cardFor,
  type CategoryBannerImage,
  type CategoryCardImage,
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

  /*
    Le cas de la table VIDE est un cas nommé, pas un tableau vide.

    Un `it.each([])` ne signale rien : il ne produit aucun test, et la suite
    passe au vert sans avoir rien vérifié. On fabrique donc un cas explicite
    qui, lui, affirme que la table est bien vide.

    Le type est annoté au lieu d'être déduit : sans annotation, TypeScript
    infère une union de deux types de tableaux et choisit la surcharge
    `it.each` en littéral de gabarit, ce qui échoue au typage.
  */
  const cas: [string, CategoryBannerImage | null][] =
    entrees.length > 0 ? entrees : [['(aucun)', null]]

  it.each(cas)(
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

  it('n’emploie que des noms de fichier qui survivent à une URL', () => {
    /*
      Le fichier livré s'appelait « bandeau pull.jpg ». Il vit très bien sur un
      disque, et très mal dans une adresse : l'espace y devient `%20`. Next
      sert le fichier, mais l'optimiseur d'images compare l'adresse demandée à
      celle qu'il a mise en cache, et un encodage divergent entre les deux
      donne un 404 — sur une seule des deux, sans jamais dire laquelle.

      Le renommer coûte trois secondes. Diagnostiquer un bandeau qui marche en
      développement et pas en production en coûte beaucoup plus.
    */
    for (const [slug, bandeau] of entrees) {
      expect(
        /^[a-z0-9/_.-]+$/.test(bandeau.src),
        `${slug} : « ${bandeau.src} » contient un caractère à encoder ` +
          '(espace, accent, majuscule). À renommer en minuscules et tirets.',
      ).toBe(true)
    }
  })

  it('rend null pour un rayon sans photographie', () => {
    expect(bannerFor('rayon-qui-n-existe-pas')).toBeNull()
  })
})

describe('les photographies choisies pour les cartes de rayon', () => {
  const entrees = Object.entries(CATEGORY_CARDS)
  const cas: [string, CategoryCardImage | null][] =
    entrees.length > 0 ? entrees : [['(aucune)', null]]

  it('désignent des fichiers présents, aux noms servables', () => {
    for (const [slug, carte] of entrees) {
      expect(
        existsSync(join(PUBLIC, carte.src)),
        `« ${slug} » déclare ${carte.src}, absent de public/`,
      ).toBe(true)
      expect(
        /^[a-z0-9/_.-]+$/.test(carte.src),
        `${slug} : « ${carte.src} » contient un caractère à encoder`,
      ).toBe(true)
    }
  })

  it.each(cas)(
    'annonce pour « %s » les dimensions réelles du fichier',
    async (slug, carte) => {
      if (carte === null) {
        expect(entrees).toHaveLength(0)
        return
      }

      /*
        Les dimensions ne sont pas décoratives : `PictureCard` les exige pour
        réserver la proportion avant le chargement. Fausses, elles ne
        provoquent aucune erreur — la carte s'affiche, puis la page SAUTE
        quand l'image arrive et impose sa vraie forme. Le défaut ne se voit
        qu'en réseau lent, c'est-à-dire jamais pendant qu'on développe.

        Le cas réaliste n'est pas la faute de frappe initiale, c'est le
        remplacement : la boutiquière fournit une meilleure photo, on écrase
        le fichier, et les chiffres restent ceux de l'ancienne.
      */
      const vraies = await sharp(join(PUBLIC, carte.src)).metadata()
      expect(
        { width: vraies.width, height: vraies.height },
        `${slug} : ${carte.src} mesure ${vraies.width}×${vraies.height}, ` +
          `mais la table annonce ${carte.width}×${carte.height}`,
      ).toEqual({ width: carte.width, height: carte.height })
    },
  )

  it('rend null pour un rayon sans photographie choisie', () => {
    expect(cardFor('rayon-qui-n-existe-pas')).toBeNull()
  })
})
