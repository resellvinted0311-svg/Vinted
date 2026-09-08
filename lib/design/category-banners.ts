/**
 * Les photographies de bandeau, rayon par rayon.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une table ici, et pas une colonne en base
 * ---------------------------------------------------------------------------
 * Une image de rayon n'est pas une donnée d'inventaire : elle ne change pas
 * quand le stock change, elle est choisie une fois pour toutes, et elle est
 * versionnée avec le site. La déposer dans `public/` et la déclarer ici, c'est
 * la traiter comme ce qu'elle est — un élément de la charte, au même titre que
 * la toile de denim.
 *
 * La colonne en base reste possible et se justifierait le jour où la boutique
 * voudra changer ces images depuis la régie, sans déploiement. Ce jour-là,
 * cette table devient la valeur par défaut et la colonne la surcharge.
 *
 * ---------------------------------------------------------------------------
 * Déclarée, jamais devinée
 * ---------------------------------------------------------------------------
 * On pourrait chercher `public/images/bandeau-<slug>.jpg` et l'employer s'il
 * existe. Ce serait plus court à écrire et beaucoup plus dur à vivre : une
 * faute de frappe dans le nom du fichier ne produirait aucune erreur, juste un
 * bandeau resté vide, et il faudrait comparer deux chaînes à l'œil pour
 * comprendre. Une table explicite se lit, et `tests/domain/category-banners.test.ts`
 * vérifie que chaque fichier déclaré existe VRAIMENT dans `public/`.
 */

export interface CategoryBannerImage {
  /**
   * Chemin servi, relatif à `public/`.
   *
   * Il commence par `/` : c'est une adresse publique, pas un chemin de
   * fichier. Next sert `public/images/x.jpg` à l'adresse `/images/x.jpg`.
   */
  src: string

  /**
   * Le point de l'image qui reste ANCRÉ quand elle est recadrée.
   *
   * -------------------------------------------------------------------------
   * Une ancre, et non une bande à montrer
   * -------------------------------------------------------------------------
   * On lit volontiers `objectPosition` comme « la partie de l'image qu'on
   * veut voir ». C'est faux, et cette lecture coûte cher : elle suppose une
   * proportion de cadre connue, or celle du bandeau varie beaucoup.
   *
   * Le composant annonce un 3/1, mais son `max-h-[34svh]` mord presque
   * toujours avant : à 1440 px de large, le cadre va du 6/1 sur une fenêtre
   * basse au 3.5/1 sur une fenêtre haute, et tombe à 2.2/1 sur un téléphone.
   * La part visible d'une photo en 3:2 passe donc de 25 % à 68 % de sa hauteur
   * selon la fenêtre — pour un seul et même réglage. Une valeur choisie en
   * visant une bande précise n'est juste que sur la fenêtre où on l'a choisie ;
   * ailleurs elle décapite le modèle, et l'on ne s'en aperçoit pas puisque
   * l'écran sur lequel on travaille, lui, va bien.
   *
   * La propriété à retenir est celle-ci : le point situé à la fraction P de la
   * SOURCE se retrouve à la fraction P du CADRE, quelle que soit la hauteur du
   * cadre. Régler `50% P%` revient donc à planter une épingle dans la
   * photographie — et si l'épingle est plantée dans le sujet, le sujet ne sort
   * jamais du champ, sur aucune fenêtre.
   *
   * D'où la méthode : repérer le sujet dans la source (une règle en
   * pourcentages superposée à l'image suffit), et poser P dessus. Pour un
   * portrait, entre le menton et le col — pas au centre géométrique, qui tombe
   * sur le ventre.
   */
  cadrage: string

  /**
   * Description de l'image pour qui ne la voit pas.
   *
   * Vide quand l'image est purement décorative — c'est le cas d'un bandeau de
   * rayon, dont le titre porte déjà l'information. Un texte du genre
   * « photographie de pull » serait lu à chaque arrivée sur le rayon pour
   * n'apprendre rien à personne.
   */
  alt: string
}

/**
 * Les bandeaux déclarés, par slug de catégorie.
 *
 * Un rayon absent de cette table n'a pas d'image : son bandeau reste sur le
 * lavis d'accent, ce qui est un état normal et non une panne.
 */
export const CATEGORY_BANNERS: Readonly<Record<string, CategoryBannerImage>> = {
  /*
    Pulls et sweats.

    Positions relevées à la règle sur la source (5992×3992) :

      28 %  main levée        30 %  haut des cheveux     38-55 %  visage
      48-58 %  col roulé      55-85 %  corps du pull     80-87 %  bordure rayée

    48 % pose donc l'ancre entre le menton et le col — c'est-à-dire sur la
    charnière entre la personne et le vêtement, les deux choses à montrer.

    Vérifié sur la page servie, de la fenêtre la plus basse à la plus haute :

      1440×700   cadre 6.03/1   bande source [36 %, 61 %]
      1440×900   cadre 4.69/1   bande source [33 %, 65 %]
      1440×1200  cadre 3.52/1   bande source [28 %, 70 %]
      390×844    cadre 2.20/1   bande source [15 %, 84 %]

    Le visage (38-55 %) tient dans les quatre. C'était le point : sur la plus
    basse — celle qui montre le moins — il reste entier.
  */
  'pulls-sweats': {
    src: '/images/bandeau-pull.jpg',
    cadrage: '50% 48%',
    // Décorative : le titre « Pulls et sweats » est juste à côté, dans le
    // bandeau, et le dit déjà.
    alt: '',
  },

  /*
    Jupes.

    Positions relevées à la règle sur la source (5992×3992) :

      0-18 %  visage et bras levés     18-40 %  débardeur
      40-95 %  la jupe longue          85-95 %  l'ourlet et les pieds

    Le sujet du rayon est la jupe, et elle occupe plus de la moitié de la
    hauteur : aucune fenêtre ne la montrera en entier, puisque la plus basse
    n'affiche que 25 % de la source. On ancre donc à 58 %, au milieu de la
    jupe :

      fenêtre basse  [43 %, 68 %]   la jupe, et rien d'autre
      fenêtre haute  [33 %, 76 %]   la jupe et la taille
      téléphone      [19 %, 87 %]   la silhouette presque entière

    C'est le cas inverse du bandeau des pulls, où le sujet à tenir était le
    visage. Ici le visage est en haut, presque hors champ dès la source, et
    ce n'est pas lui qu'on vend.
  */
  jupes: {
    src: '/images/bandeau-jupes.jpg',
    cadrage: '50% 58%',
    alt: '',
  },
}

/** L'image d'un rayon, ou `null` s'il n'en a pas encore. */
export function bannerFor(slug: string): CategoryBannerImage | null {
  return CATEGORY_BANNERS[slug] ?? null
}

/**
 * Une photographie CHOISIE pour la carte d'un rayon.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle remplace, et pourquoi le remplacement était prévu
 * ---------------------------------------------------------------------------
 * Les cartes de rayon s'illustrent d'elles-mêmes : `getCategoryCovers` prend la
 * dernière pièce entrée dans la catégorie et emprunte son premier visuel. Ce
 * choix se tient — il montre ce que la boutique a vraiment et se met à jour
 * tout seul — et son commentaire annonçait déjà la suite : « le jour où un
 * visuel choisi devient souhaitable, il se posera par-dessus ». C'est ce jour.
 *
 * Une photographie choisie l'emporte donc sur celle qui est dérivée du stock,
 * et seulement pour les rayons qui en déclarent une. Les autres continuent de
 * s'illustrer tout seuls : ce n'est pas un mécanisme qu'on remplace, c'est une
 * exception qu'on autorise.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi les dimensions sont écrites ici
 * ---------------------------------------------------------------------------
 * `PictureCard` les EXIGE, et pour une bonne raison : sans elles la proportion
 * n'est pas réservée avant le chargement, et la page saute quand l'image
 * arrive. Elles sont donc déclarées à la main — et
 * `tests/domain/category-banners.test.ts` les relit dans le fichier réel, pour
 * qu'une photographie remplacée par une autre de taille différente échoue
 * bruyamment plutôt que de faire sauter la vitrine.
 */
export interface CategoryCardImage {
  src: string
  width: number
  height: number
  alt: string
}

export const CATEGORY_CARDS: Readonly<Record<string, CategoryCardImage>> = {
  /*
    Chaussures.

    Aucun cadrage à régler ici, et c'est la proportion qui l'explique : la
    carte est un 4/5 vertical, la photographie un 3:2 horizontal. Le rognage
    est donc LATÉRAL, pas vertical — l'inverse du bandeau. La bande visible
    couvre 53 % de la largeur, soit [23 %, 77 %] au centre, et les escarpins
    tiennent entre 33 % et 58 %. Ils sont dedans, avec de la marge des deux
    côtés : le centre par défaut convient.
  */
  chaussures: {
    src: '/images/carte-chaussures.jpg',
    width: 5992,
    height: 3992,
    alt: '',
  },
}

/** La photographie choisie pour la carte d'un rayon, ou `null`. */
export function cardFor(slug: string): CategoryCardImage | null {
  return CATEGORY_CARDS[slug] ?? null
}
