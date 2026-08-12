import 'server-only'

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Jeton de session boutique.
 *
 * Identifie un visiteur sans compte pour son panier et ses favoris. Stocké
 * dans un cookie httpOnly : ni le panier ni les favoris ne vivent en
 * localStorage, qui n'est ni fiable ni consultable côté serveur.
 *
 * Ce même jeton sert de propriétaire du verrou de stock au checkout
 * (Article.reservedById), d'où sa durée de vie longue.
 */
export const SHOP_SESSION_COOKIE = 'ND_SESSION'

/** 30 jours — durée de conservation du panier annoncée dans le brief. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export async function readShopSessionToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SHOP_SESSION_COOKIE)?.value ?? null
}

/**
 * Renvoie le jeton existant, ou en crée un.
 *
 * À n'appeler que depuis une Server Action ou un Route Handler : écrire un
 * cookie pendant le rendu d'une page lève en Next 15.
 */
export async function ensureShopSessionToken(): Promise<string> {
  const store = await cookies()
  const existing = store.get(SHOP_SESSION_COOKIE)?.value

  if (existing && existing.length >= 32) return existing

  const token = randomBytes(24).toString('base64url')

  store.set(SHOP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })

  return token
}
