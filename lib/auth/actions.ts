'use server'

import { prisma } from '@/lib/db/client'
import { signUpSchema, signInSchema, magicLinkSchema } from '@/lib/validation/auth'
import { hashPassword, verifyPassword } from './password'
import { createDatabaseSession, destroyCurrentSession } from './session'
import { signIn as authSignIn } from './index'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { mergeGuestFavorites } from '@/lib/shop/favorites'
import { isAuthConfigured } from '@/lib/config/site'

export type AuthActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'success' }
  | { status: 'magic-link-sent' }

/**
 * Inscription.
 *
 * Le consentement marketing est distinct de l'acceptation des CGV et n'est
 * jamais pré-coché : sa date est horodatée pour servir de preuve.
 */
export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  // Refus AVANT toute écriture.
  //
  // Sans secret de signature, la session serait bien créée en base et le
  // cookie bien posé — mais `getCurrentUser()` renvoie `null`, donc la
  // personne repart aussitôt vers la connexion, avec un compte qu'elle ne
  // peut plus utiliser et une adresse désormais « déjà prise ». Mieux vaut
  // n'écrire rien du tout et le dire.
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined,
    locale: formData.get('locale'),
    marketingConsent: formData.get('marketingConsent') === 'on',
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.path[0] === 'password') {
      return { status: 'error', messageKey: 'passwordTooShort' }
    }
    return { status: 'error', messageKey: 'invalidEmail' }
  }

  const { email, password, firstName, lastName, locale, marketingConsent } =
    parsed.data

  const allowed = await checkRateLimit({
    key: `signup:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 3600,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existing) return { status: 'error', messageKey: 'emailTaken' }

  const passwordHash = await hashPassword(password)
  const now = new Date()

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      locale,
      marketingConsent,
      marketingConsentAt: marketingConsent ? now : null,
    },
    select: { id: true },
  })

  await createDatabaseSession(user.id)

  // Les favoris mis de côté avant l'inscription suivent dans le compte :
  // c'est ce qui rend l'ajout aux favoris utile sans compte.
  await mergeGuestFavorites(user.id)

  return { status: 'success' }
}

/**
 * Connexion par mot de passe.
 *
 * Le message d'erreur est le même que l'adresse soit inconnue ou le mot de
 * passe faux : distinguer les deux révèle quelles adresses ont un compte.
 */
export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  // Même raison qu'à l'inscription : la session serait ouverte puis illisible.
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { status: 'error', messageKey: 'invalidCredentials' }
  }

  const { email, password } = parsed.data

  const allowed = await checkRateLimit({
    key: `signin:${await clientFingerprint()}:${email}`,
    limit: 10,
    windowSeconds: 900,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, bannedAt: true },
  })

  const valid = await verifyPassword(user?.passwordHash, password)

  if (!user || !valid) {
    return { status: 'error', messageKey: 'invalidCredentials' }
  }
  if (user.bannedAt) {
    return { status: 'error', messageKey: 'banned' }
  }

  await createDatabaseSession(user.id)
  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  })

  // Reprise des favoris déposés depuis ce navigateur avant la connexion.
  await mergeGuestFavorites(user.id)

  return { status: 'success' }
}

/** Connexion par lien envoyé par e-mail. */
export async function magicLinkAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  // Le lien magique passe par Auth.js de bout en bout : sans secret, il
  // échouerait après l'envoi de l'e-mail, donc au pire moment possible.
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = magicLinkSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
  })

  if (!parsed.success) {
    return { status: 'error', messageKey: 'invalidEmail' }
  }

  const allowed = await checkRateLimit({
    key: `magic:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 900,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  await authSignIn('magic-link', {
    email: parsed.data.email,
    redirect: false,
  })

  // Réponse identique qu'un compte existe ou non : on n'énumère pas les
  // adresses inscrites.
  return { status: 'magic-link-sent' }
}

export async function signOutAction(): Promise<void> {
  await destroyCurrentSession()
}
