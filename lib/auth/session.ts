import 'server-only'

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/db/client'
import { isAuthConfigured } from '@/lib/config/site'
import { rotateShopSessionToken } from '@/lib/shop/session-token'
import { auth } from './index'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from './cookies'

export interface CurrentUser {
  id: string
  email: string
  role: 'CUSTOMER' | 'ADMIN'
  locale: string
  firstName: string | null
}

/**
 * Ouvre une session en base et pose le cookie correspondant.
 *
 * Utilisé par la connexion par mot de passe : le provider Credentials
 * d'Auth.js v5 impose la stratégie JWT, incompatible avec l'exigence de
 * sessions en base. On crée donc la ligne `Session` nous-mêmes, avec
 * exactement le cookie qu'Auth.js relira ensuite.
 */
export async function createDatabaseSession(userId: string): Promise<void> {
  // 32 octets d'entropie, encodés en hexadécimal : le jeton n'est jamais
  // dérivé de l'identifiant utilisateur.
  const sessionToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)

  await prisma.session.create({
    data: { sessionToken, userId, expires },
  })

  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, sessionToken, {
    ...sessionCookieOptions,
    expires,
  })
}

/** Ferme la session courante côté base ET côté navigateur. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE_NAME)?.value

  if (token) {
    // deleteMany : une session déjà expirée et purgée ne doit pas lever.
    await prisma.session.deleteMany({ where: { sessionToken: token } })
  }

  // `store.delete(nom)` n'émet pas l'attribut Secure. Or un cookie dont le nom
  // commence par `__Secure-` est REJETÉ par le navigateur s'il ne le porte
  // pas : la suppression échouerait silencieusement en production et la
  // déconnexion ne fermerait rien côté navigateur. On réécrit donc le cookie
  // vide avec exactement les mêmes attributs qu'à la pose.
  store.set(SESSION_COOKIE_NAME, '', {
    ...sessionCookieOptions,
    maxAge: 0,
    expires: new Date(0),
  })

  // Le jeton de session BOUTIQUE tourne aussi.
  //
  // Il ne porte pas d'identité — mais il porte le panier et les favoris. Le
  // laisser en place sur un poste partagé ferait hériter la personne suivante
  // de ce que la précédente avait mis de côté.
  await rotateShopSessionToken()
}

/**
 * Identité courante, ou null.
 *
 * Toujours relue en base : un compte suspendu ou supprimé perd l'accès
 * immédiatement, sans attendre l'expiration du cookie.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isAuthConfigured()) return null

  // `auth` est surchargé — il sert aussi de middleware — donc son type de
  // retour inféré n'est pas celui d'une session. On l'annote explicitement.
  let session: Session | null = null
  try {
    session = await auth()
  } catch (error) {
    // Une session illisible — secret changé, cookie corrompu — signifie
    // « pas connecté », pas « page en erreur ». Le catalogue doit rester
    // consultable quoi qu'il arrive.
    console.error('[auth] Session illisible.', error)
    return null
  }

  if (!session?.user?.id) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      locale: true,
      firstName: true,
      bannedAt: true,
    },
  })

  if (!user || user.bannedAt) return null

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    locale: user.locale,
    firstName: user.firstName,
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/** Exige une session valide. À appeler au début de chaque action protégée. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new AuthorizationError('Authentification requise.')
  return user
}

/**
 * Exige le rôle ADMIN.
 *
 * Le middleware filtre déjà /admin, mais il ne consulte que la présence du
 * cookie : il ne peut pas interroger la base depuis l'Edge. Le contrôle qui
 * fait autorité est celui-ci, et il doit être appelé dans CHAQUE action
 * serveur et chaque route d'administration — jamais seulement au routage.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser()
  if (user.role !== 'ADMIN') {
    throw new AuthorizationError('Accès réservé à l’administration.')
  }
  return user
}
