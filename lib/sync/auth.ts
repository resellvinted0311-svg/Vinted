import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

import { pseudonymize } from '@/lib/security/pseudonymize'

/**
 * Authentification de l'application de gestion.
 *
 * ---------------------------------------------------------------------------
 * Un secret partagé, et pourquoi c'est suffisant ici
 * ---------------------------------------------------------------------------
 * Un seul appelant, connu, qui écrit dans l'inventaire. Pas de comptes, pas de
 * portée, pas de révocation partielle à gérer : une clé posée des deux côtés en
 * variable d'environnement répond exactement au besoin, et tout ce qui serait
 * plus riche serait du code à maintenir sans usage.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi hacher AVANT de comparer
 * ---------------------------------------------------------------------------
 * `timingSafeEqual` exige deux tampons de même longueur, et lève sinon.
 * Comparer les longueurs d'abord marche — c'est ce que fait la route de cron —
 * mais cela divulgue la longueur du secret, et surtout cela oblige à ne pas
 * oublier le garde-fou à chaque nouvel appel.
 *
 * En comparant deux SHA-256, les tampons font toujours 32 octets : la
 * comparaison est à temps constant de bout en bout, la longueur ne fuit pas, et
 * il n'y a plus de branche à oublier. Le haché n'est pas un stockage de mot de
 * passe — on ne le range nulle part — c'est un égaliseur de longueur.
 *
 * ---------------------------------------------------------------------------
 * Sans clé configurée, la route refuse tout
 * ---------------------------------------------------------------------------
 * Une variable oubliée en production ouvrirait l'écriture du catalogue au
 * premier venu. On préfère un import qui échoue bruyamment à un import qui
 * réussit pour n'importe qui.
 */

/** La clé de synchronisation est-elle configurée ? */
export function isSyncConfigured(): boolean {
  return Boolean(process.env.SYNC_API_KEY)
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Extrait le porteur d'un en-tête `Authorization`.
 *
 * Renvoie `null` si l'en-tête est absent ou n'est pas du `Bearer`. Le schéma
 * est comparé sans tenir compte de la casse : la RFC 7235 le veut insensible,
 * et un client qui écrit `bearer` n'est pas un client hostile.
 */
function bearerFrom(header: string | null): string | null {
  if (!header) return null

  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? null
}

export interface SyncCaller {
  /**
   * Jeton opaque désignant la clé utilisée, pour compter les appels sans
   * jamais écrire la clé elle-même dans un magasin tiers ni dans un journal.
   *
   * Pas de rotation quotidienne : un compteur de débit qui repart de zéro à
   * minuit UTC est acceptable pour une page de connexion — l'attaquant
   * gagnerait dix essais — mais ici la fenêtre est d'une minute, et la
   * rotation n'apporterait rien qu'un calcul de plus.
   */
  counterKey: string
}

/**
 * Vérifie l'en-tête et renvoie de quoi compter les appels, ou `null`.
 *
 * Ne renvoie JAMAIS la clé : ce qui remonte à l'appelante est un pseudonyme,
 * précisément pour qu'il ne puisse pas finir dans une trace d'exécution.
 */
export function authenticateSync(header: string | null): SyncCaller | null {
  const expected = process.env.SYNC_API_KEY
  if (!expected) return null

  const provided = bearerFrom(header)
  if (!provided) return null

  if (!timingSafeEqual(sha256(provided), sha256(expected))) return null

  return {
    counterKey: pseudonymize({ purpose: 'sync:api-key', value: expected }),
  }
}
