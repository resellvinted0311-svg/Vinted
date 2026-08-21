/**
 * Chemin de reprise après connexion.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une garde, et pourquoi celle-ci
 * ---------------------------------------------------------------------------
 * Après une connexion, on renvoie la personne là où elle allait. Ce « là où »
 * arrive dans l'URL, donc depuis l'extérieur : `?suite=…` peut être fabriqué
 * par n'importe qui et envoyé à une victime.
 *
 * La garde précédente se contentait de `startsWith('/')`. Elle laissait passer
 * `//evil.com`, que le navigateur lit comme une URL absolue à protocole
 * relatif — donc une redirection ouverte vers un site tiers, sur une page de
 * connexion, c'est-à-dire au moment exact où l'on vient de taper un mot de
 * passe. C'est le scénario d'hameçonnage le plus classique qui soit.
 *
 * Elle n'était sauvée que par le préfixe de langue ajouté ensuite par le
 * routeur, protection accidentelle qui disparaîtrait au premier changement de
 * routeur ou passage en `localePrefix: 'as-needed'`.
 *
 * On exige donc : une barre de tête, et immédiatement après, autre chose
 * qu'une barre ou une contre-oblique — les navigateurs traitent `\` comme `/`
 * dans une origine.
 *
 * Ce module ne dépend de rien : il est importé par le middleware, qui tourne
 * sur l'Edge, et par un composant client.
 */
const SAFE_PATH = /^\/(?![/\\])[^\s]*$/

export function isSafeInternalPath(value: string | null | undefined): boolean {
  if (!value) return false
  if (value.length > 512) return false
  return SAFE_PATH.test(value)
}

/**
 * Retire le préfixe de langue d'un chemin.
 *
 * Le middleware stockait le chemin COMPLET, préfixe compris. Le routeur de
 * next-intl le préfixe une seconde fois au moment de rediriger : `/fr/compte`
 * devenait `/fr/fr/compte`, donc une 404. La reprise vers la page demandée ne
 * fonctionnait tout simplement jamais.
 */
export function stripLocalePrefix(
  pathname: string,
  locales: readonly string[],
): string {
  const [, first, ...rest] = pathname.split('/')
  if (!first || !locales.includes(first)) return pathname

  const remainder = rest.join('/')
  return remainder === '' ? '/' : `/${remainder}`
}
