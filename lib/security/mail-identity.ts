/**
 * L'identité de BOÎTE derrière une adresse e-mail, pour les compteurs.
 *
 * ---------------------------------------------------------------------------
 * Le contournement que ce module ferme
 * ---------------------------------------------------------------------------
 * Trois compteurs du projet bornent les envois par ADRESSE, avec la même
 * justification écrite : ne pas laisser noyer la boîte d'une personne ciblée
 * sous des messages légitimement signés par notre domaine — plaintes pour spam
 * chez le prestataire, mise en quarantaine de l'adresse d'envoi, et plus aucun
 * e-mail transactionnel délivré à personne, confirmations de commande
 * comprises.
 *
 * Ils calculaient tous leur clé sur l'adresse TELLE QUE SAISIE. Or
 * `victime+1@gmail.com`, `victime+2@gmail.com` et `vic.time@gmail.com`
 * arrivent toutes dans la MÊME boîte, et produisaient trois pseudonymes
 * différents — donc trois seaux neufs. Le plafond de cinq envois par heure
 * devenait cinq envois par variante, c'est-à-dire aucun plafond.
 *
 * ---------------------------------------------------------------------------
 * Deux règles, et leurs limites, assumées
 * ---------------------------------------------------------------------------
 * 1. LE SOUS-ADRESSAGE. Tout ce qui suit un `+` dans la partie locale est une
 *    étiquette, pas une boîte différente. La convention est portée par Gmail,
 *    Outlook, Proton, Fastmail et la plupart des serveurs courants.
 *
 *    Sa limite : quelques serveurs traitent réellement `a+b@` comme une boîte
 *    distincte de `a@`. Pour eux, deux personnes différentes partageraient un
 *    seau. Le coût est une limitation un peu plus stricte pour un cas rare ;
 *    le coût inverse — un plafond qui ne borne rien — est bien plus lourd.
 *
 * 2. LES POINTS, CHEZ GOOGLE SEULEMENT. Gmail ignore les points de la partie
 *    locale. C'est une particularité documentée de ce fournisseur, et elle ne
 *    s'applique nulle part ailleurs : chez d'autres, `jean.dupont@` et
 *    `jeandupont@` sont deux boîtes bien distinctes. La règle est donc bornée
 *    aux domaines de Google, jamais généralisée.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module NE fait PAS
 * ---------------------------------------------------------------------------
 * Il ne sert QU'aux clés de compteur. L'adresse enregistrée sur une offre, sur
 * une commande ou dans un compte reste celle que la personne a saisie : c'est
 * la sienne, c'est là qu'elle attend son courrier, et la réécrire lui ferait
 * perdre le filtre qu'elle avait mis en place en ajoutant son étiquette.
 *
 * Il ne valide rien non plus. Une chaîne qui n'est pas une adresse est rendue
 * en minuscules, sans plus : la validation appartient à Zod, en amont.
 */

/** Domaines où le point de la partie locale n'a aucune signification. */
const DOTLESS_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Ramène une adresse à la boîte qu'elle désigne réellement.
 *
 * Le résultat n'est PAS une adresse valide et n'a pas à l'être : c'est une clé
 * de regroupement, destinée à être pseudonymisée juste après.
 */
export function mailboxIdentity(email: string): string {
  const trimmed = email.trim().toLowerCase()

  // On coupe sur le DERNIER `@` : la partie locale peut en contenir quand elle
  // est entre guillemets, et couper sur le premier découperait au mauvais
  // endroit.
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return trimmed

  let local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)

  // Le sous-adressage : tout ce qui suit le `+` est une étiquette.
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  // `plus === 0` — une partie locale qui COMMENCE par `+` — laisserait une
  // chaîne vide, donc un seau partagé par toutes les adresses de ce domaine.
  // On la laisse alors telle quelle.

  if (DOTLESS_DOMAINS.has(domain)) local = local.replaceAll('.', '')

  return `${local}@${domain}`
}
