/**
 * L'adresse par laquelle une image est SERVIE, dérivée de celle où elle est
 * rangée.
 *
 * ---------------------------------------------------------------------------
 * Le gaspillage que ce module supprime
 * ---------------------------------------------------------------------------
 * `ArticleImage.url` porte le `secure_url` que renvoie l'hébergeur : l'adresse
 * de l'ORIGINAL, sans aucune transformation. Les visuels sont ré-encodés à
 * l'ingestion, mais pas redimensionnés — une photo de studio arrive jusqu'à
 * 6 000 pixels de large et repart telle quelle.
 *
 * L'optimiseur de Next fabrique ensuite une variante par largeur et par
 * format : il TÉLÉCHARGE l'original à chaque fois. Une seule fiche article,
 * avec dix visuels et huit largeurs utiles, demande donc quatre-vingts
 * téléchargements de plusieurs mégaoctets — payés en bande passante chez
 * l'hébergeur d'images, en temps de calcul chez l'hébergeur du site, et en
 * délai de première visite chez la cliente.
 *
 * En bornant la largeur SOURCE, l'original ne quitte jamais l'hébergeur : ce
 * qui traverse le réseau est déjà à la taille utile. `f_auto` et `q_auto`
 * laissent en outre l'hébergeur choisir le format et la compression, ce qu'il
 * fait mieux qu'un réglage figé parce qu'il voit l'image.
 *
 * ---------------------------------------------------------------------------
 * Dérivé à la lecture, jamais rangé en base
 * ---------------------------------------------------------------------------
 * La base garde l'adresse canonique de l'original. Une transformation écrite
 * en base serait figée : la changer demanderait une reprise de données, et
 * l'original deviendrait inaccessible depuis le code — or c'est lui qui sert
 * de source à tout le reste, y compris à une éventuelle ré-ingestion.
 */

/**
 * Largeur maximale servie.
 *
 * Deux mille quatre-vingt-seize pixels : le double de la plus grande largeur
 * d'affichage prévue (1 048 px pour une galerie plein écran sur grand
 * moniteur), pour couvrir les écrans à deux fois la densité. Au-delà, la
 * différence n'est plus visible et le poids, lui, continue de croître.
 */
export const MAX_DELIVERY_WIDTH = 2096

/**
 * Reconnaît une adresse de livraison Cloudinary.
 *
 * Le segment `/image/upload/` est la charnière : ce qui le suit est soit une
 * liste de transformations, soit directement la version et le chemin du
 * fichier. C'est là, et nulle part ailleurs, qu'une transformation s'insère.
 */
const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/

/**
 * Une liste de transformations est déjà présente ?
 *
 * Un segment de transformation se reconnaît à ses paramètres séparés par des
 * virgules et introduits par deux lettres et un tiret bas — `w_800`, `f_auto`,
 * `c_fill`. Le segment de VERSION, lui, est `v` suivi de chiffres ; le chemin
 * du fichier ne ressemble ni à l'un ni à l'autre.
 *
 * On ne réécrit jamais une adresse déjà transformée : elle a été composée
 * ailleurs, pour une raison qu'on ignore ici, et l'empiler ferait payer deux
 * transformations pour un seul résultat.
 */
const DEJA_TRANSFORMEE = /^[a-z]{1,2}_[^/]*\//

export interface DeliveryOptions {
  /** Largeur maximale de la SOURCE, en pixels. */
  width?: number
}

/**
 * L'adresse à donner à l'optimiseur.
 *
 * Renvoie l'adresse inchangée si elle n'est pas servie par l'hébergeur
 * d'images — visuels de démonstration servis en local, adresse relative,
 * adresse d'un autre hôte. Ne jamais bricoler une adresse qu'on ne comprend
 * pas : au mieux elle cesse de répondre, au pire elle répond autre chose.
 */
export function deliveryUrl(url: string, options: DeliveryOptions = {}): string {
  const correspondance = CLOUDINARY.exec(url)
  if (!correspondance) return url

  const [, prefixe, reste] = correspondance as unknown as [
    string,
    string,
    string,
  ]

  if (DEJA_TRANSFORMEE.test(reste)) return url

  const largeur = Math.min(
    Math.max(Math.round(options.width ?? MAX_DELIVERY_WIDTH), 1),
    MAX_DELIVERY_WIDTH,
  )

  /*
    `c_limit` et non `c_fill` ou `c_scale`.

    `c_limit` REDUIT une image trop grande et laisse une image plus petite
    intacte : il ne recadre rien et n'agrandit rien. Les deux autres
    changeraient ce qu'on voit — un recadrage coupe le vêtement, un
    agrandissement fabrique des pixels — alors qu'on ne veut ici que borner le
    poids de la source.
  */
  return `${prefixe}f_auto,q_auto,c_limit,w_${largeur}/${reste}`
}
