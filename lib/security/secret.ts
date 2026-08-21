import 'server-only'

import { randomBytes } from 'node:crypto'

/**
 * Le secret serveur, et son repli.
 *
 * Plusieurs mécanismes en dépendent — pseudonymisation des compteurs de débit,
 * signature du jeton de session boutique — et ils doivent tous tirer la même
 * valeur au même endroit. Deux lectures divergentes de `process.env` finiraient
 * par diverger tout court.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un repli aléatoire et non une constante
 * ---------------------------------------------------------------------------
 * Sans `AUTH_SECRET`, il faut bien une clé. Une constante écrite dans le dépôt
 * serait publiée avec lui : toute signature deviendrait forgeable par
 * quiconque a lu le code, ce qui est exactement le contraire du but.
 *
 * On tire donc 32 octets au démarrage du processus. Conséquences assumées :
 * les signatures ne survivent pas à un redémarrage, et deux instances ne se
 * reconnaissent pas. C'est acceptable là où ce repli sert — développement et
 * tests, où l'authentification est de toute façon neutralisée par
 * `isAuthConfigured()`. En production, `AUTH_SECRET` est requise.
 */
let ephemeralKey: Buffer | null = null
let warned = false

export function serverSecret(): string | Buffer {
  const configured = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (configured) return configured

  if (!ephemeralKey) {
    ephemeralKey = randomBytes(32)

    if (process.env.NODE_ENV === 'production' && !warned) {
      warned = true
      console.error(
        '[secret] AUTH_SECRET absent : clé éphémère par processus. ' +
          'Les signatures et compteurs ne survivent ni à un redémarrage ni ' +
          'au passage d’une instance à l’autre.',
      )
    }
  }

  return ephemeralKey
}

/** Réinitialise la clé éphémère. Réservé aux tests. */
export function __resetServerSecretForTests(): void {
  ephemeralKey = null
  warned = false
}
