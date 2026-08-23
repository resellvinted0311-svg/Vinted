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
