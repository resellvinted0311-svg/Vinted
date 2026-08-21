import NextAuth, { type DefaultSession } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { Provider } from 'next-auth/providers'
import { prisma } from '@/lib/db/client'
import { sendMagicLinkEmail } from '@/lib/providers/email/magic-link'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from './cookies'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'CUSTOMER' | 'ADMIN'
      locale: string
      firstName: string | null
    } & DefaultSession['user']
  }
}

/**
 * Connexion par lien magique.
 *
 * Volontairement décrit à la main plutôt qu'importé depuis
 * `next-auth/providers/resend` : l'envoi doit rester possible sans clé API en
 * développement (le lien est alors écrit dans la console).
 *
 * ---------------------------------------------------------------------------
 * À RÉGLER AVEC LE TUNNEL DE COMMANDE — ne pas brancher le paiement sans
 * ---------------------------------------------------------------------------
 * Le rappel du lien est un GET sans contrôle CSRF. C'est le comportement de
 * `@auth/core` pour `type: 'email'`, vérifié dans le code de la bibliothèque,
 * pas une particularité d'ici.
 *
 * Conséquence : quelqu'un demande un lien pour SA PROPRE adresse et l'amène
 * devant une victime — un lien dans un message, une image qui charge l'URL.
 * Le navigateur de la victime se retrouve authentifié sur le compte de
 * l'attaquant, sans qu'aucun écran ne le signale.
 *
 * Aujourd'hui, la victime ne peut y déposer qu'un favori, et le flux est de
 * toute façon inerte tant que Resend n'est pas configuré. **Cela change de
 * nature avec le tunnel de commande** : elle y saisirait son adresse postale
 * et ses coordonnées, qui seraient enregistrées sur le compte d'un tiers.
 *
 * Correctif à poser en même temps que le paiement : une confirmation par
 * bouton (donc un POST) sur la page de rappel, ou un nonce déposé en cookie
 * chez le navigateur demandeur et vérifié au retour.
 */
const magicLinkProvider: Provider = {
  id: 'magic-link',
  type: 'email',
  name: 'Lien de connexion',
  from: process.env.EMAIL_FROM ?? 'onboarding@resend.dev',
  // 15 minutes : au-delà, le lien est périmé.
  maxAge: 15 * 60,
  options: {},
  async sendVerificationRequest({ identifier, url, expires }) {
    await sendMagicLinkEmail({ to: identifier, url, expires })
  },
}

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  adapter: PrismaAdapter(prisma),

  // Sessions en base : le brief l'exige, et cela permet de révoquer une
  // session côté serveur (bannissement, déconnexion à distance), ce qu'un JWT
  // ne permet pas.
  session: {
    strategy: 'database',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 60 * 60 * 24,
  },

  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: sessionCookieOptions,
    },
  },

  // La connexion par mot de passe n'utilise pas de provider Credentials :
  // celui-ci force la stratégie JWT dans Auth.js v5, incompatible avec les
  // sessions en base. Elle est traitée dans lib/auth/session.ts, qui crée la
  // ligne Session et pose le même cookie.
  providers: [magicLinkProvider],

  pages: {
    signIn: '/fr/connexion',
    error: '/fr/connexion',
    verifyRequest: '/fr/connexion',
  },

  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false

      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { bannedAt: true },
      })

      // Un compte suspendu ne peut pas se reconnecter par lien magique.
      return !existing?.bannedAt
    },

    async session({ session, user }) {
      const record = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, locale: true, firstName: true, bannedAt: true },
      })

      if (!record || record.bannedAt) {
        // Session orpheline ou compte suspendu : on ne renvoie pas d'identité.
        return { ...session, user: { ...session.user, id: '', role: 'CUSTOMER', locale: 'fr', firstName: null } }
      }

      session.user.id = user.id
      session.user.role = record.role
      session.user.locale = record.locale
      session.user.firstName = record.firstName

      return session
    },
  },

  events: {
    async signIn({ user }) {
      if (!user.id) return
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeenAt: new Date() },
      })
    },
  },

  trustHost: true,
})
