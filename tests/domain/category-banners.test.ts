import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  CATEGORY_BANNERS,
  CATEGORY_CARDS,
  UNIVERSE_CARDS,
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

/**
 * L'adresse déclarée se lit en DEUX parties : le chemin du fichier, et une
 * version facultative.
 *
 * La version existe parce qu'une photographie peut être remplacée sous le même
 * nom de fichier — et que, dans ce cas, l'optimiseur d'images continue de
 * servir l'ancienne : il garde son résultat en cache sous la clé de l'adresse,
 * et l'adresse n'a pas changé. Mesuré sur le bandeau des accessoires.
 *
 * Tous les contrôles ci-dessous portent donc sur le CHEMIN. Les écrire sur
 * l'adresse entière ferait échouer le test d'existence — `public/…jpg?v=2`
 * n'est le nom d'aucun fichier — et celui du format, puisque l'adresse ne se
 * termine plus par `.jpg`. C'est le genre de faux échec qui pousse à
 * désactiver un test plutôt qu'à le corriger.
 */
function decouper(src: string): { chemin: string; version: string | null } {
  const [chemin = '', requete] = src.split('?')
  return { chemin, version: requete ?? null }
}

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

      const chemin = join(PUBLIC, decouper(bandeau.src).chemin)
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
        /\.(jpe?g|png|webp|avif)$/i.test(decouper(bandeau.src).chemin),
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
        /^[a-z0-9/_.-]+$/.test(decouper(bandeau.src).chemin),
        `${slug} : « ${bandeau.src} » contient un caractère à encoder ` +
          '(espace, accent, majuscule). À renommer en minuscules et tirets.',
      ).toBe(true)
    }
  })

  it('ne porte, après le chemin, qu’un numéro de version', () => {
    /*
      La partie qui suit le « ? » sert à UNE chose : forcer les caches à
      relire l'image quand on la remplace sous le même nom. Elle s'écrit donc
      `v=` suivi d'un nombre, et rien d'autre.

      Ce n'est pas du purisme. Cette chaîne part telle quelle dans l'adresse de
      l'optimiseur d'images, où elle est ré-encodée : une esperluette ou un
      caractère accentué y produirait une adresse différente de celle qu'on
      croit avoir écrite, et le symptôme serait un bandeau vide — sans erreur,
      comme d'habitude avec les images.
    */
    for (const [slug, bandeau] of entrees) {
      const { version } = decouper(bandeau.src)
      if (version === null) continue
      expect(
        /^v=\d+$/.test(version),
        `${slug} : « ?${version} » n’est pas un numéro de version`,
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
        existsSync(join(PUBLIC, decouper(carte.src).chemin)),
        `« ${slug} » déclare ${carte.src}, absent de public/`,
      ).toBe(true)
      expect(
        /^[a-z0-9/_.-]+$/.test(decouper(carte.src).chemin),
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
      const vraies = await sharp(
        join(PUBLIC, decouper(carte.src).chemin),
      ).metadata()
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

describe('les visuels des deux cartes d’univers', () => {
  /*
    Les mêmes contrôles que pour les cartes de rayon, et pour les mêmes
    raisons — un fichier absent ne provoque aucune erreur, des dimensions
    fausses font sauter la page au chargement.

    Un troisième contrôle compte double ici : ces deux photographies ont été
    déposées depuis un Mac, sous des noms contenant une espace et un accent en
    forme DÉCOMPOSÉE. Servi tel quel, un nom pareil répond 404 alors qu'il
    paraît exact à la lecture, parce que l'accent du système et celui du code
    ne sont pas le même octet. Le renommage est la parade ; ce test est ce qui
    empêche de l'oublier au prochain dépôt.
  */
  const entrees = Object.entries(UNIVERSE_CARDS)

  it('couvre les deux univers, et seulement eux', () => {
    expect(Object.keys(UNIVERSE_CARDS).sort()).toEqual(['femme', 'homme'])
  })

  it('désignent des fichiers présents, aux noms servables', () => {
    for (const [univers, carte] of entrees) {
      expect(
        existsSync(join(PUBLIC, decouper(carte.src).chemin)),
        `« ${univers} » déclare ${carte.src}, absent de public/`,
      ).toBe(true)
      expect(
        /^[a-z0-9/_.-]+$/.test(decouper(carte.src).chemin),
        `${univers} : « ${carte.src} » contient un caractère à encoder`,
      ).toBe(true)
    }
  })

  it.each(entrees)(
    'annonce pour « %s » les dimensions réelles du fichier',
    async (univers, carte) => {
      const vraies = await sharp(
        join(PUBLIC, decouper(carte.src).chemin),
      ).metadata()
      expect(
        { width: vraies.width, height: vraies.height },
        `${univers} : ${carte.src} mesure ${vraies.width}×${vraies.height}, ` +
          `mais la table annonce ${carte.width}×${carte.height}`,
      ).toEqual({ width: carte.width, height: carte.height })
    },
  )
})
