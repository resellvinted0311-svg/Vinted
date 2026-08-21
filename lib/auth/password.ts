import { hash, verify } from '@node-rs/argon2'
import { randomBytes } from 'node:crypto'

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
 * Empreinte leurre, calculée une fois par processus sur un secret aléatoire.
 *
 * Elle ne correspond à aucun mot de passe possible : le tirage fait 256 bits.
 * Sa seule raison d'être est de coûter le même temps qu'une vérification
 * réelle — voir `verifyPassword`.
 */
let decoy: Promise<string> | null = null

function decoyDigest(): Promise<string> {
  decoy ??= hashPassword(randomBytes(32).toString('hex'))
  return decoy
}

/**
 * Vérifie un mot de passe.
 *
 * Renvoie `false` sur empreinte absente ou corrompue plutôt que de lever : un
 * compte créé par lien magique n'a pas de mot de passe, ce n'est pas une
 * erreur, c'est un refus.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi on travaille aussi quand il n'y a rien à vérifier
 * ---------------------------------------------------------------------------
 * Le message d'erreur de la connexion est volontairement le même que l'adresse
 * soit inconnue ou le mot de passe faux. Cette précaution ne servait à rien
 * tant que le CHRONOMÈTRE, lui, répondait : sans empreinte, on repartait en
 * une fraction de milliseconde, contre une centaine pour un argon2id complet.
 * Deux essais suffisaient à distinguer les deux cas, et donc à énumérer les
 * adresses inscrites — précisément ce que le message uniforme voulait empêcher.
 *
 * On effectue donc la même vérification, contre un leurre, avant de refuser.
 * Le coût est réel et c'est le but : il rend les deux chemins indiscernables
 * de l'extérieur.
 */
export async function verifyPassword(
  digest: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!digest) {
    await verify(await decoyDigest(), password, ARGON2_OPTIONS).catch(
      () => false,
    )
    return false
  }

  try {
    return await verify(digest, password, ARGON2_OPTIONS)
  } catch {
    return false
  }
}
