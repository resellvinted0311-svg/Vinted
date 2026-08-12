import { hash, verify } from '@node-rs/argon2'

/**
 * Paramètres argon2id.
 *
 * Reprend la configuration minimale recommandée par l'OWASP : 19 MiB de
 * mémoire, 2 passes, 1 fil. `Algorithm` est un `const enum` inutilisable avec
 * `isolatedModules`, mais argon2id est déjà la valeur par défaut de la
 * bibliothèque — l'assertion ci-dessous le vérifie plutôt que de le supposer.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  const digest = await hash(password, ARGON2_OPTIONS)

  if (!digest.startsWith('$argon2id$')) {
    throw new Error(
      `Hachage inattendu : argon2id est requis, obtenu « ${digest.slice(0, 12)} ».`,
    )
  }

  return digest
}

/**
 * Vérifie un mot de passe.
 *
 * Renvoie `false` sur empreinte absente ou corrompue plutôt que de lever : un
 * compte créé par lien magique n'a pas de mot de passe, ce n'est pas une
 * erreur, c'est un refus.
 */
export async function verifyPassword(
  digest: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!digest) return false

  try {
    return await verify(digest, password, ARGON2_OPTIONS)
  } catch {
    return false
  }
}
