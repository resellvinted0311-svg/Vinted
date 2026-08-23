import { routing, type Locale } from './routing'

/**
 * Chargement des catalogues de messages HORS requête.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce module existe
 * ---------------------------------------------------------------------------
 * `getTranslations` de next-intl lit la configuration attachée à la requête en
 * cours. C'est parfait dans une page ; c'est inutilisable partout où il n'y a
 * pas de requête, ni donc de langue « courante » :
 *
 *  - la file de travaux, qui compose l'e-mail de confirmation d'une commande
 *    passée il y a dix minutes ;
 *  - l'import d'inventaire, qui rédige une description dans les huit langues
 *    en une seule fois.
 *
 * Dans ces deux cas la langue est une DONNÉE — celle de la commande, celle de
 * la fiche — pas un état ambiant. On charge donc le catalogue explicitement.
 *
 * ---------------------------------------------------------------------------
 * Le repli est silencieux, et c'est voulu
 * ---------------------------------------------------------------------------
 * Une locale inconnue retombe sur la langue par défaut plutôt que de lever :
 * un e-mail de confirmation ne doit jamais échouer parce qu'une colonne
 * `locale` contient une valeur d'une version antérieure du code.
 */

/**
 * Forme des messages, tirée du français.
 *
 * Sert UNIQUEMENT au typage : le test de parité des traductions garantit déjà
 * que les huit langues ont exactement les mêmes clés. Sans ce type, les clés
 * ne seraient plus vérifiées à la compilation et une faute de frappe
 * n'apparaîtrait qu'à l'exécution.
 */
export type Messages = typeof import('../../messages/fr.json')

const cache = new Map<Locale, Messages>()

/** Catalogue d'une langue, chargé à la demande et mémorisé par processus. */
export async function loadMessages(locale: string): Promise<Messages> {
  const known = (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale

  const cached = cache.get(known)
  if (cached) return cached

  const messages = (await import(`../../messages/${known}.json`))
    .default as Messages

  cache.set(known, messages)
  return messages
}
