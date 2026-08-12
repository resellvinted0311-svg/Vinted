/**
 * Nom et attributs du cookie de session.
 *
 * Ils sont déclarés ici plutôt que laissés aux valeurs par défaut d'Auth.js :
 * la connexion par mot de passe crée la session à la main (voir
 * lib/auth/session.ts) et doit poser exactement le même cookie que celui
 * qu'Auth.js relira. Une divergence produirait une session invisible.
 */
export const useSecureCookies = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE_NAME = useSecureCookies
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token'

/** Durée de vie d'une session : 30 jours, glissante. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: useSecureCookies,
} as const
