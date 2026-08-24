import NextAuth, { type DefaultSession } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { Provider } from 'next-auth/providers'
import { prisma } from '@/lib/db/client'
import { adoptGuestSession } from '@/lib/shop/handover'
import { sendMagicLinkEmail } from '@/lib/providers/email/magic-link'
import { SITE } from '@/lib/config/site'
import { locales } from '@/lib/i18n/routing'
import { confirmationPageUrl } from './magic-link-guard'
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
 * Le lien envoyé N'EST PAS le rappel d'Auth.js
 * ---------------------------------------------------------------------------
 * Le rappel d'Auth.js est un GET sans contrôle CSRF — le comportement de
 * `@auth/core` pour `type: 'email'`, pas une particularité d'ici. Il suffisait
 * alors d'amener cette adresse devant quelqu'un pour authentifier son
 * navigateur sur le compte de celui qui avait demandé le lien.
 *
 * L'e-mail pointe donc vers une page de CONFIRMATION, qui exige un geste — un
 * POST, protégé par le contrôle d'origine de Next — avant de laisser passer.
 * Le rappel lui-même refuse tout GET qui ne présente pas la preuve posée par
 * ce geste : `app/api/auth/[...nextauth]/route.ts` et
 * `lib/auth/magic-link-guard.ts`, où le raisonnement est écrit en entier.
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
    await sendMagicLinkEmail({
      to: identifier,
      url: confirmationPageUrl(url, localeOf(url)),
      expires,
    })
  },
}

/**
 * La langue à donner à la page de confirmation.
 *
 * Auth.js ne transmet pas la langue du formulaire, mais l'adresse de retour
 * qu'il a mise dans l'URL de rappel la porte : c'est la page d'où la demande
 * est partie. À défaut, le français, comme les pages déclarées plus bas.
 */
function localeOf(callbackUrl: string): string {
  try {
    const after = new URL(callbackUrl).searchParams.get('callbackUrl')
    if (!after) return 'fr'
    const segment = new URL(after, SITE.url).pathname.split('/')[1] ?? ''
    return locales.includes(segment as (typeof locales)[number]) ? segment : 'fr'
  } catch {
    return 'fr'
  }
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
    /**
     * Ouverture de session par LIEN MAGIQUE.
     *
     * Ce chemin-là ne passe pas par `signInAction` : Auth.js crée la session
     * lui-même quand la personne clique le lien reçu. Tout ce que la connexion
     * par mot de passe fait ensuite doit donc être refait ici, sinon deux des
     * trois portes d'entrée se comportent d'une façon et la troisième d'une
     * autre.
     *
     * Ce qui manquait, et ce que ça coûtait :
     *  - le panier et les favoris déposés avant la connexion étaient PERDUS,
     *    exactement comme ils l'étaient sur les deux autres chemins avant
     *    correction ;
     *  - les commandes payées sans compte n'étaient pas rattachées ;
     *  - et surtout le jeton de session boutique n'était pas renouvelé. Sur un
     *    poste partagé, la personne suivante héritait du panier et des favoris
     *    de la précédente — c'est précisément ce que le renouvellement existe
     *    pour empêcher.
     */
    async signIn({ user }) {
      if (!user.id) return

      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeenAt: new Date() },
      })

      if (user.email) {
        // L'adresse vient du lien vérifié par Auth.js : c'est bien celle avec
        // laquelle la personne vient de prouver son identité.
        await adoptGuestSession(user.id, user.email)
      }
    },
  },

  trustHost: true,
})
