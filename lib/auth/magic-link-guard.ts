import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

import { SITE } from '@/lib/config/site'
import { serverSecret } from '@/lib/security/secret'

/**
 * Le rappel du lien de connexion, rendu inoffensif.
 *
 * ---------------------------------------------------------------------------
 * Le défaut, tel qu'il était écrit dans `lib/auth/index.ts`
 * ---------------------------------------------------------------------------
 * Le rappel d'un lien magique est un GET sans contrôle CSRF. C'est le
 * comportement de `@auth/core` pour `type: 'email'`, pas une particularité
 * d'ici. Quelqu'un demande un lien pour SA PROPRE adresse et amène l'URL devant
 * une victime — un lien dans un message, une image qui charge l'adresse. Le
 * navigateur de la victime se retrouve authentifié sur le compte de
 * l'attaquant, sans qu'aucun écran ne le signale.
 *
 * Le commentaire d'origine fixait l'échéance : « À RÉGLER AVEC LE TUNNEL DE
 * COMMANDE — ne pas brancher le paiement sans ». Le tunnel est branché depuis.
 * Tant que la victime ne pouvait déposer qu'un favori, le dommage restait
 * théorique ; elle saisit désormais son adresse postale et son téléphone dans
 * un tunnel de commande, qui seraient enregistrés sur le compte d'un tiers.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une confirmation par BOUTON, et pas un nonce chez le demandeur
 * ---------------------------------------------------------------------------
 * Les deux étaient proposés. Le nonce déposé chez le navigateur qui DEMANDE le
 * lien casserait l'usage le plus fréquent : demander le lien sur l'ordinateur
 * et l'ouvrir sur le téléphone. Un lien de connexion qui n'accepte qu'un seul
 * appareil n'est plus un lien de connexion.
 *
 * La confirmation par bouton n'a pas ce défaut : le cookie est posé par le
 * navigateur qui CONFIRME, une seconde avant le rappel, dans le même appareil.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le bouton seul ne suffirait pas
 * ---------------------------------------------------------------------------
 * Une page de confirmation ne protège de rien si l'adresse de rappel reste
 * ouverte à côté : l'attaquant la connaît, puisqu'il a demandé le lien. Il lui
 * suffirait de sauter l'écran.
 *
 * C'est donc le RAPPEL qui exige la preuve — un cookie posé par la
 * confirmation, lié au jeton par un HMAC. Un GET direct ne l'a pas. Le POST de
 * confirmation, lui, est protégé par le contrôle d'origine de Next sur les
 * Server Actions et par `sameSite=lax`, qui empêche un site tiers de le
 * déclencher.
 */

/** Nom du cookie de confirmation. Préfixé `__Host-` en production. */
export function confirmationCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Host-magic-confirm'
    : 'magic-confirm'
}

/**
 * Cinq minutes : le temps de cliquer, pas davantage.
 *
 * Le cookie n'est qu'un laissez-passer d'un geste vers le suivant. Lui donner
 * la durée du jeton (quinze minutes) élargirait la fenêtre sans rien apporter.
 */
const CONFIRMATION_MAX_AGE_SECONDS = 5 * 60

/**
 * Preuve liée AU JETON, pas un simple drapeau.
 *
 * Un cookie « j'ai confirmé » se réutiliserait d'un lien à l'autre : la victime
 * confirme sa propre connexion, l'attaquant lui présente ensuite son lien à
 * lui, et le cookie encore vivant le laisserait passer. En faisant entrer le
 * jeton dans le HMAC, la preuve ne vaut que pour le lien confirmé.
 */
function proofFor(token: string): string {
  return createHmac('sha256', serverSecret())
    .update(`magic-link-confirm.${token}`)
    .digest('base64url')
}

/** Extrait le jeton de l'URL de rappel d'Auth.js. */
export function tokenFromCallback(url: URL): string | null {
  return url.searchParams.get('token')
}

/**
 * L'URL de rappel est-elle bien la nôtre, et bien un rappel de lien magique ?
 *
 * Appelée sur une valeur qui traverse l'e-mail puis le formulaire de
 * confirmation : sans ce contrôle, le paramètre deviendrait une redirection
 * ouverte signée par notre domaine.
 */
export function isMagicCallbackUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    if (url.origin !== new URL(SITE.url).origin) return false
    if (url.pathname !== '/api/auth/callback/magic-link') return false
    return tokenFromCallback(url) !== null
  } catch {
    return false
  }
}

/**
 * Adresse de la page de confirmation, à mettre dans l'e-mail à la place du
 * rappel direct.
 */
export function confirmationPageUrl(callbackUrl: string, locale: string): string {
  const page = new URL(`/${locale}/connexion/lien`, SITE.url)
  page.searchParams.set('suite', callbackUrl)
  return page.toString()
}

/** Pose la preuve de confirmation. Appelée par l'action du bouton. */
export async function writeConfirmation(token: string): Promise<void> {
  const store = await cookies()
  store.set(confirmationCookieName(), proofFor(token), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CONFIRMATION_MAX_AGE_SECONDS,
  })
}

/**
 * Le rappel présente-t-il la preuve du jeton qu'il porte ?
 *
 * Comparaison à temps constant : la preuve est dérivée d'un secret, et une
 * comparaison qui s'arrête au premier octet différent la laisserait deviner
 * octet par octet.
 */
export async function hasConfirmation(token: string): Promise<boolean> {
  const store = await cookies()
  const given = store.get(confirmationCookieName())?.value
  if (!given) return false

  const expected = proofFor(token)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * Retire la preuve : elle a servi.
 *
 * Sans cela, elle resterait valable cinq minutes pour ce même jeton — or un
 * jeton de lien magique est à usage unique, et sa preuve doit l'être aussi.
 */
export async function clearConfirmation(): Promise<void> {
  const store = await cookies()
  store.delete(confirmationCookieName())
}
