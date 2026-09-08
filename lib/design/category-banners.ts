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
   * Le point de l'image qui reste visible quand elle est recadrée.
   *
   * Le bandeau est un 3/1 très large ; une photographie ordinaire y est donc
   * rognée en haut et en bas, parfois beaucoup. Laissé au centre — le défaut
   * de `object-fit: cover` — le cadre tombe souvent sur le ventre du modèle :
   * le vêtement est coupé et le visage sort du champ.
   *
   * On remonte donc le point d'intérêt. La valeur est une position CSS
   * (`objectPosition`) : `50% 30%` garde le milieu horizontal et le tiers
   * supérieur, ce qui cadre les épaules et le buste — c'est-à-dire le
   * vêtement.
   *
   * Elle se règle image par image, en la regardant. Il n'y a pas de valeur
   * universellement juste : elle dépend d'où se trouve le sujet dans SA photo.
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
export const CATEGORY_BANNERS: Readonly<
  Record<string, CategoryBannerImage>
> = {}

/** L'image d'un rayon, ou `null` s'il n'en a pas encore. */
export function bannerFor(slug: string): CategoryBannerImage | null {
  return CATEGORY_BANNERS[slug] ?? null
}
