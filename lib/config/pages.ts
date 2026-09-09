import { hasLegalIdentity } from '@/lib/config/site'

/**
 * Les pages statiques du site, et l'état de leur contenu.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce fichier a évité, et qu'il continue d'éviter
 * ---------------------------------------------------------------------------
 * Le tunnel de commande exigeait l'acceptation des conditions générales et
 * enregistrait `cgvVersion` avec un horodatage, comme PREUVE. Or la page
 * correspondante affichait « Contenu rédigé en Phase 7 ». On constituait donc
 * la preuve écrite qu'une personne avait accepté un document qui n'existe pas.
 *
 * Ce n'est pas une preuve incomplète, c'est une preuve fausse : produite dans
 * un litige, elle se retourne contre celui qui l'invoque.
 *
 * D'où le principe tenu ici : une seule source décide à la fois de ce que la
 * page AFFICHE et de ce que le tunnel ENREGISTRE. On ne peut pas publier un
 * texte sans que les preuves commencent à être constituées, ni constituer des
 * preuves sans que le texte soit publié.
 *
 * Les conditions générales, la page cookies et la page livraison ont depuis
 * été écrites. La condition qui reste est ailleurs, et elle est expliquée sur
 * `areTermsPublished` : un contrat suppose un vendeur identifié.
 */
/**
 * Les pages éditoriales et légales servies par `/pages/[slug]`.
 *
 * Déplacée ici depuis la route elle-même le jour où le plan de site a eu
 * besoin de la même liste. Deux listes de slugs auraient divergé au premier
 * ajout, et la divergence aurait été silencieuse : une page servie mais jamais
 * annoncée, ou annoncée et introuvable.
 *
 * ---------------------------------------------------------------------------
 * `contact` est un slug d'ici, et non une route `/contact`
 * ---------------------------------------------------------------------------
 * Le pied de page annonçait « Contact » vers `/contact` depuis le premier
 * jour. La route n'a jamais existé : le lien tombait en 404, dans les huit
 * langues, à chaque page du site. C'est aussi la voie que la page de
 * confidentialité et le formulaire de rétractation désignent pour écrire à la
 * boutique.
 *
 * Le rattacher à cette liste plutôt que d'ouvrir une route à part donne
 * gratuitement ce qu'elle porte déjà : URL canonique, hreflang sur les huit
 * langues, prérendu, et surtout la même règle qu'ailleurs — aucune coordonnée
 * n'est inventée tant que l'identité de l'entreprise n'est pas renseignée.
 */
export const PAGE_SLUGS = [
  'mentions-legales',
  'cgv',
  'confidentialite',
  'cookies',
  'livraison',
  'retours',
  'contact',
  'a-propos',
] as const

export type PageSlug = (typeof PAGE_SLUGS)[number]

export function isPageSlug(value: string): value is PageSlug {
  return (PAGE_SLUGS as readonly string[]).includes(value)
}

/**
 * LA LISTE EST VIDE : les trois pages ont été rédigées.
 *
 * Elle reste en place, et ce n'est pas de la nostalgie. C'est le mécanisme qui
 * a évité de constituer une preuve d'acceptation contre un document
 * inexistant ; il resservira au prochain texte ajouté au site avant d'être
 * écrit, et une liste vide dit cela mieux qu'une liste supprimée.
 *
 * Attention : « rédigées » ne veut pas dire « opposables ». Des conditions de
 * vente désignent un vendeur, et un vendeur sans identité n'engage personne.
 * C'est `areTermsPublished` ci-dessous qui tient cette seconde condition.
 */
export const PLACEHOLDER_PAGES = [] as const

export function isPlaceholderPage(slug: string): boolean {
  return (PLACEHOLDER_PAGES as readonly string[]).includes(slug)
}

/**
 * Les conditions générales de vente sont-elles réellement publiées ?
 *
 * Tant que la réponse est non, aucune acceptation n'est horodatée. La case
 * reste dans le tunnel — un tunnel écrit sans elle serait à reprendre
 * entièrement — mais elle dit ce qu'elle est.
 *
 * ---------------------------------------------------------------------------
 * DEUX conditions, et la seconde a été ajoutée en écrivant le texte
 * ---------------------------------------------------------------------------
 * La première est que les conditions existent. C'est désormais le cas.
 *
 * La seconde est que le VENDEUR existe. Des conditions générales sont un
 * contrat entre un acheteur et quelqu'un ; tant que le nom, l'immatriculation
 * et l'adresse de ce quelqu'un ne sont pas renseignés, la page l'annonce au
 * lieu d'afficher le texte — c'est déjà la règle des mentions légales et du
 * formulaire de rétractation.
 *
 * Horodater une acceptation dans cet état reproduirait exactement le défaut
 * qu'on avait corrigé, à un cran de subtilité près : la preuve désignerait un
 * document réel, mais accepté auprès d'un vendeur que rien n'identifie. Elle
 * ne vaudrait pas davantage.
 *
 * Conséquence pratique : renseigner l'identité de l'entreprise en variables
 * d'environnement publie les conditions et déclenche la constitution des
 * preuves, sans qu'aucun code ne change.
 */
export function areTermsPublished(): boolean {
  return !isPlaceholderPage('cgv') && hasLegalIdentity()
}
