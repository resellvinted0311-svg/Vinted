import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { serverSecret } from '@/lib/security/secret'

/**
 * Jeton de session boutique.
 *
 * Identifie un visiteur sans compte pour son panier et ses favoris. Stocké
 * dans un cookie httpOnly : ni le panier ni les favoris ne vivent en
 * localStorage, qui n'est ni fiable ni consultable côté serveur.
 *
 * Ce même jeton sert de propriétaire du verrou de stock au paiement
 * (`Article.reservedById`), d'où sa durée de vie longue.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il est signé
 * ---------------------------------------------------------------------------
 * La version précédente adoptait TOUTE valeur d'au moins 32 caractères, sans
 * vérifier qu'elle venait du serveur, sans borne haute et sans format. Trois
 * conséquences, de la plus discrète à la plus coûteuse :
 *
 *  - **fixation.** Le cookie est httpOnly, donc inaccessible au JavaScript
 *    d'une page — mais pas à un sous-domaine, qui peut poser un cookie sur le
 *    domaine parent, ni à quiconque fabrique sa propre requête. Choisir le
 *    jeton d'autrui suffisait alors à voir ses favoris et, demain, son panier ;
 *  - **croissance illimitée.** Le jeton est la clé indexée de `GuestFavorite`
 *    et de `Cart`. Une valeur arbitrairement longue faisait grossir l'index
 *    jusqu'à la limite de PostgreSQL (~2704 octets), au-delà de laquelle chaque
 *    clic sur « favori » devenait une erreur 500 ;
 *  - **rien ne prouvait l'émission.** Impossible de distinguer un jeton
 *    légitime d'un jeton inventé.
 *
 * Le jeton porte donc `charge.signature`, où la signature est un HMAC-SHA256
 * tronqué à 128 bits, comparé à temps constant. Sans le secret serveur, on ne
 * peut ni en forger un ni en deviner un. Une valeur invalide n'est pas une
 * erreur : elle est simplement remplacée par un jeton neuf.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il tourne au changement de personne
 * ---------------------------------------------------------------------------
 * Le cookie survivait à la connexion comme à la déconnexion. Sur un poste
 * partagé — une famille, un ordinateur de bureau —, la personne A butinait en
 * visiteur, la personne B se connectait, et **héritait silencieusement des
 * favoris de A**. Le cookie d'authentification, lui, était bien renouvelé :
 * c'est celui-ci qui manquait.
 *
 * `rotateShopSessionToken()` est donc appelée après chaque bascule d'identité,
 * une fois la reprise des favoris terminée.
 */

/**
 * Nom du cookie, préfixé en production.
 *
 * `__Host-` impose au navigateur : transmission chiffrée obligatoire, chemin
 * racine, et surtout **aucun attribut Domain** — donc impossible pour un
 * sous-domaine de poser ce cookie sur le domaine parent. C'est la deuxième
 * serrure sur la fixation, après la signature.
 *
 * Le préfixe est incompatible avec `http://localhost`, d'où les deux noms.
 * Même schéma que les cookies d'Auth.js.
 */
const SECURE_COOKIE = '__Host-ND_SESSION'
const PLAIN_COOKIE = 'ND_SESSION'

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function shopSessionCookieName(): string {
  return isProduction() ? SECURE_COOKIE : PLAIN_COOKIE
}

/** Conservé pour les tests et les outils qui lisent le cookie par son nom. */
export const SHOP_SESSION_COOKIE = PLAIN_COOKIE

/**
 * 30 jours — durée de conservation du panier annoncée dans le brief.
 *
 * Doit rester égale à `GUEST_DATA_RETENTION_DAYS` : les données rattachées à
 * ce cookie ne doivent pas lui survivre. Un test vérifie l'égalité, faute de
 * quoi les deux dériveraient sans bruit.
 */
export const SHOP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/** 24 octets → 32 caractères base64url. */
const PAYLOAD_BYTES = 24
/** 128 bits de signature : hors de portée d'une recherche exhaustive. */
const SIGNATURE_BYTES = 16

/**
 * Forme exacte du jeton : 32 caractères, un point, 22 caractères.
 *
 * L'expression est ancrée aux deux bouts. C'est elle qui borne la longueur —
 * 55 caractères, quoi qu'il arrive — et donc la taille de l'index.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$/

/** Longueur maximale du jeton, reprise par la contrainte de colonne. */
export const SHOP_SESSION_TOKEN_MAX_LENGTH = 64

function sign(payload: string): string {
  return createHmac('sha256', serverSecret())
    .update(`shop-session ${payload}`)
    .digest('base64url')
    .slice(0, Math.ceil((SIGNATURE_BYTES * 4) / 3))
}

function mint(): string {
  const payload = randomBytes(PAYLOAD_BYTES).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/**
 * Le jeton a-t-il été émis par ce serveur ?
 *
 * La comparaison est à temps constant. Le gain est théorique ici — la
 * signature n'est pas un secret partagé qu'on devinerait octet par octet —
 * mais l'habitude compte plus que le cas d'espèce : c'est la comparaison
 * naïve, prise partout, qui finit par mordre là où elle compte.
 */
export function isValidShopSessionToken(token: string): boolean {
  if (!TOKEN_SHAPE.test(token)) return false

  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length) return false

  return timingSafeEqual(expected, given)
}

/**
 * Lit le jeton, ou `null`.
 *
 * Un jeton invalide est traité comme absent : on ne se met pas à chercher en
 * base les favoris d'une valeur que personne n'a jamais émise.
 */
export async function readShopSessionToken(): Promise<string | null> {
  const store = await cookies()

  // Les deux noms sont lus : un déploiement peut basculer de l'un à l'autre,
  // et une session ouverte ne doit pas se perdre à ce moment-là.
  const raw =
    store.get(shopSessionCookieName())?.value ??
    store.get(PLAIN_COOKIE)?.value ??
    store.get(SECURE_COOKIE)?.value

  if (!raw || !isValidShopSessionToken(raw)) return null
  return raw
}

function writeCookie(store: Awaited<ReturnType<typeof cookies>>, token: string) {
  store.set(shopSessionCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    // `__Host-` l'exige, et c'est de toute façon ce qu'il nous faut : le
    // panier suit la visiteuse sur tout le site.
    path: '/',
    maxAge: SHOP_SESSION_MAX_AGE_SECONDS,
  })
}

/**
 * Renvoie le jeton existant, ou en crée un.
 *
 * À n'appeler que depuis une Server Action ou un Route Handler : écrire un
 * cookie pendant le rendu d'une page lève en Next 15.
 */
export async function ensureShopSessionToken(): Promise<string> {
  const store = await cookies()

  const existing =
    store.get(shopSessionCookieName())?.value ??
    store.get(PLAIN_COOKIE)?.value ??
    store.get(SECURE_COOKIE)?.value

  if (existing && isValidShopSessionToken(existing)) return existing

  const token = mint()
  writeCookie(store, token)
  return token
}

/**
 * Renouvelle le jeton — connexion, inscription, déconnexion.
 *
 * À appeler APRÈS la reprise des favoris : elle a besoin de l'ancien jeton
 * pour retrouver ce qu'il faut reprendre. L'ordre inverse perdrait
 * silencieusement les favoris déposés avant la connexion.
 */
export async function rotateShopSessionToken(): Promise<string> {
  const store = await cookies()
  const token = mint()

  // L'ancien nom est effacé explicitement : sans cela, un cookie `ND_SESSION`
  // hérité d'avant le passage au préfixe `__Host-` survivrait au
  // renouvellement, et `readShopSessionToken` pourrait le retrouver.
  if (shopSessionCookieName() !== PLAIN_COOKIE) {
    store.delete(PLAIN_COOKIE)
  }

  writeCookie(store, token)
  return token
}
