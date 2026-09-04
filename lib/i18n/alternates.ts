import { locales, localeTags, defaultLocale } from './routing'

/**
 * L'adresse canonique d'une page et ses huit équivalents traduits.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette fonction existe
 * ---------------------------------------------------------------------------
 * Le même bloc de cinq lignes était recopié à la main dans chaque
 * `generateMetadata` : construire la table des langues, y ajouter
 * `x-default` en écrivant « /fr » en dur, puis composer le canonique. Six
 * copies, et rien qui les compare.
 *
 * Aucun test ne couvre les canoniques ni les hreflang page par page — le seul
 * filet est le plan de site, qui vérifie que CHAQUE entrée porte ses neuf
 * langues, mais il ne voit pas les en-têtes des pages. Une septième copie, avec
 * sa faute de frappe possible, n'aurait donc été rattrapée par rien : une
 * langue oubliée dans la table, ou un `x-default` pointant vers la mauvaise
 * page, ne casse aucun rendu et ne se voit que dans les outils pour webmestres,
 * des semaines plus tard.
 *
 * ---------------------------------------------------------------------------
 * `x-default` vient de la langue par défaut, il n'est plus écrit à la main
 * ---------------------------------------------------------------------------
 * Six occurrences de « /fr » en dur signifiaient six endroits à corriger le
 * jour où la langue par défaut changerait — et six occasions d'en oublier une,
 * sans rien pour le signaler.
 *
 * ---------------------------------------------------------------------------
 * Des adresses RELATIVES, comme partout ailleurs
 * ---------------------------------------------------------------------------
 * Next les résout contre `metadataBase`, posé une seule fois dans la mise en
 * page racine. Écrire le domaine ici en ferait une deuxième source, et deux
 * sources d'un domaine finissent par se contredire au premier changement de
 * nom.
 */
export function localeAlternates(
  locale: string,
  /**
   * Le chemin SANS préfixe de langue, commençant par une barre oblique —
   * `/catalogue`, `/marque/levis`. Chaîne vide pour l'accueil.
   */
  path: string,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}${path}`]),
  )
  languages['x-default'] = `/${defaultLocale}${path}`

  return { canonical: `/${locale}${path}`, languages }
}
