/**
 * Pages statiques dont le contenu n'est pas encore rédigé.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette liste existe
 * ---------------------------------------------------------------------------
 * Leur URL, leur place dans la navigation et leurs liens sont en place dès
 * maintenant, pour que le référencement ne change plus ensuite. Mais elles
 * n'ont pas de texte, et il faut que le code le SACHE — pas seulement que la
 * page l'affiche.
 *
 * Le cas qui l'a rendu nécessaire : le tunnel de commande exigeait
 * l'acceptation des conditions générales et enregistrait `cgvVersion` avec un
 * horodatage, comme PREUVE. Or la page correspondante affichait « Contenu
 * rédigé en Phase 7 ». On constituait donc la preuve écrite qu'une personne
 * avait accepté un document qui n'existe pas.
 *
 * Ce n'est pas une preuve incomplète, c'est une preuve fausse : produite dans
 * un litige, elle se retourne contre celui qui l'invoque.
 *
 * ---------------------------------------------------------------------------
 * Une seule liste, deux effets
 * ---------------------------------------------------------------------------
 * La page affiche son avertissement à partir d'ici, et le tunnel décide à
 * partir d'ici s'il enregistre une acceptation. Le jour où les conditions
 * générales seront écrites, retirer `cgv` de cette liste suffira : la mention
 * disparaît et la preuve commence à être constituée, sans qu'on puisse faire
 * l'un sans l'autre.
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

export const PLACEHOLDER_PAGES = ['cgv', 'cookies', 'livraison'] as const

export function isPlaceholderPage(slug: string): boolean {
  return (PLACEHOLDER_PAGES as readonly string[]).includes(slug)
}

/**
 * Les conditions générales de vente sont-elles réellement publiées ?
 *
 * Tant que la réponse est non, aucune acceptation n'est horodatée. La case
 * reste dans le tunnel — un tunnel écrit sans elle serait à reprendre
 * entièrement — mais elle dit ce qu'elle est.
 */
export function areTermsPublished(): boolean {
  return !isPlaceholderPage('cgv')
}
