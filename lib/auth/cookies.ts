/**
 * Nom et attributs du cookie de session.
 *
 * Ils sont déclarés ici plutôt que laissés aux valeurs par défaut d'Auth.js :
 * la connexion par mot de passe crée la session à la main (voir
 * lib/auth/session.ts) et doit poser exactement le même cookie que celui
 * qu'Auth.js relira. Une divergence produirait une session invisible.
 */
export const useSecureCookies = process.env.NODE_ENV === 'production'

/**
 * `__Host-` et non `__Secure-`.
 *
 * ---------------------------------------------------------------------------
 * Ce que le préfixe ajoute, et pourquoi il manquait au pire endroit
 * ---------------------------------------------------------------------------
 * `__Secure-` exige seulement que le cookie ait été posé sur HTTPS. Il
 * n'interdit PAS l'attribut `Domain` : un sous-domaine compromis —
 * `staging.exemple.fr`, un hébergement de pages, un service tiers sur le même
 * apex — peut poser `__Secure-authjs.session-token; Domain=exemple.fr` et
 * écraser le cookie du domaine parent. C'est une fixation de session : la
 * personne se retrouve, sans le savoir, sur le compte de quelqu'un d'autre.
 *
 * `__Host-` ferme cela : le navigateur refuse le cookie s'il porte un `Domain`,
 * si son chemin n'est pas `/`, ou s'il n'est pas `Secure`. Les trois conditions
 * étaient déjà remplies ici — seul le préfixe manquait.
 *
 * L'incohérence était interne au projet : le jeton de session BOUTIQUE, qui ne
 * porte qu'un panier et des favoris, avait déjà `__Host-` et le raisonnement
 * écrit (`lib/shop/session-token.ts`). Le cookie qui porte l'IDENTITÉ avait la
 * serrure la plus faible des deux.
 */
export const SESSION_COOKIE_NAME = useSecureCookies
  ? '__Host-authjs.session-token'
  : 'authjs.session-token'

/** Durée de vie d'une session : 30 jours, glissante. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: useSecureCookies,
} as const
