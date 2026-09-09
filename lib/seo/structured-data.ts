import { SITE, LEGAL, hasLegalIdentity } from '@/lib/config/site'
import { localeTags, type Locale } from '@/lib/i18n/routing'

/**
 * Les données structurées qui ne sont pas celles d'une pièce.
 *
 * ---------------------------------------------------------------------------
 * Ce qui existait, et ce qui manquait
 * ---------------------------------------------------------------------------
 * La fiche article déclare un bloc `Product` complet — prix, disponibilité,
 * état, visuels. C'est le bloc qui rapporte le plus, et il est juste.
 *
 * Il était le SEUL. Rien ne disait au moteur ce qu'est ce site ni qui le tient
 * :
 *
 *  - pas de `WebSite`, donc rien qui rattache les centaines de fiches à une
 *    entité unique, et rien qui décrive la recherche interne ;
 *  - pas d'`Organization`, donc aucun rattachement entre la boutique et son
 *    identité légale — celle-là même que les mentions légales publient déjà
 *    en toutes lettres ;
 *  - pas d'`ItemList` sur les pages de listing, donc chaque grille était, pour
 *    le moteur, une page de vignettes sans ordre ni contenu déclaré.
 *
 * ---------------------------------------------------------------------------
 * Rien n'est inventé, et une donnée absente fait disparaître son bloc
 * ---------------------------------------------------------------------------
 * `Organization` n'est émise que si l'identité légale est renseignée. Publier
 * un `Organization` sans nom ni adresse serait pire que ne rien publier : les
 * outils de contrôle le signalent comme une entité incomplète, et cela
 * s'applique au domaine entier.
 *
 * Le logo est délibérément ABSENT. Un `Organization.logo` doit pointer sur une
 * image matricielle stable ; les icônes du site sont générées par Next, qui
 * ajoute à leur adresse une empreinte de contenu changeant à chaque
 * modification. Une adresse en dur ici finirait donc par pointer dans le vide,
 * et une propriété `logo` cassée invalide le bloc entier.
 */

/** Le `@id` stable du site, référencé par les autres blocs. */
export function idSite(): string {
  return `${SITE.url}/#website`
}

/** Le `@id` stable de l'entreprise. */
export function idOrganisation(): string {
  return `${SITE.url}/#organization`
}

/**
 * Le bloc `WebSite`, avec la recherche interne.
 *
 * `SearchAction` décrit une adresse que le site sert RÉELLEMENT :
 * `/{langue}/catalogue?q=…` est la cible du formulaire de recherche, celle que
 * `parseCatalogueSearchParams` lit. Décrire une recherche que le site n'a pas
 * est une des rares erreurs de données structurées qui se voit tout de suite —
 * le moteur essaie l'adresse.
 */
export function blocSite(locale: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': idSite(),
    name: SITE.name,
    url: `${SITE.url}/${locale}`,
    inLanguage: localeTags[locale as Locale] ?? localeTags.fr,
    ...(hasLegalIdentity() ? { publisher: { '@id': idOrganisation() } } : {}),
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.url}/${locale}/catalogue?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

/**
 * Le bloc `Organization`, ou `null` tant que l'identité n'est pas renseignée.
 *
 * L'adresse est passée en TEXTE et non en `PostalAddress` : la configuration
 * la porte en une seule chaîne libre, et la découper ici en rue, code postal
 * et ville reviendrait à deviner. Schema.org accepte les deux formes ; une
 * adresse exacte en texte vaut mieux qu'une adresse structurée fausse.
 */
export function blocOrganisation(): Record<string, unknown> | null {
  if (!hasLegalIdentity()) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': idOrganisation(),
    name: LEGAL.companyName,
    legalName: LEGAL.companyName,
    url: SITE.url,
    email: LEGAL.email,
    address: LEGAL.address,
    identifier: LEGAL.siret,
  }
}

/**
 * Le bloc `ItemList` d'une page de listing.
 *
 * Il ne porte QUE des adresses, jamais une copie des prix et des titres. C'est
 * la forme recommandée pour une page sommaire : chaque fiche pointée porte
 * déjà son bloc `Product`, et recopier ces valeurs ici créerait une seconde
 * source qui se désynchroniserait au premier changement de prix — un prix
 * structuré différent du prix affiché fait perdre le résultat enrichi.
 *
 * `position` commence à 1, et suit l'ordre de la grille : c'est ce que la
 * propriété signifie.
 */
export function blocListe(
  locale: string,
  slugs: string[],
): Record<string, unknown> | null {
  if (slugs.length === 0) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: slugs.length,
    itemListElement: slugs.map((slug, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${SITE.url}/${locale}/a/${slug}`,
    })),
  }
}
