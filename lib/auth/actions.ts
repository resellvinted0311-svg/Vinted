'use server'

import { prisma } from '@/lib/db/client'
import { signUpSchema, signInSchema, magicLinkSchema } from '@/lib/validation/auth'
import { hashPassword, verifyPassword } from './password'
import { createDatabaseSession, destroyCurrentSession } from './session'
import { signIn as authSignIn } from './index'
import { checkRateLimit, clearRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
import { mailboxIdentity } from '@/lib/security/mail-identity'
import { adoptGuestSession } from '@/lib/shop/handover'
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
    sensitive: true,
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

  // Favoris, panier et commandes déposés avant l'inscription suivent dans le
  // compte, puis le jeton de session est renouvelé. L'ordre des deux est la
  // seule chose qui compte, et il est tenu dans `adoptGuestSession` : la
  // reprise a besoin de l'ANCIEN jeton.
  await adoptGuestSession(user.id, email)

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

  // DEUX compteurs, et le second est le plus important.
  //
  // Compter par couple (empreinte, adresse) ne freine que l'acharnement sur UN
  // compte. La pulvérisation — un mot de passe très courant essayé contre des
  // milliers d'adresses différentes — ne touchait jamais le plafond, puisque
  // chaque adresse ouvrait son propre compteur. Le second compteur, par
  // empreinte seule, ferme cette porte.
  const fingerprint = await clientFingerprint()

  // L'adresse e-mail ne sort JAMAIS en clair dans une clé de compteur : elle
  // partirait telle quelle dans le chemin d'URL des requêtes au prestataire de
  // limitation, où elle serait journalisée chez lui. Le jeton distingue les
  // comptes aussi bien que l'adresse — c'est tout ce que le compteur demande.
  const account = pseudonymize({
    purpose: 'rate-limit:signin-email',
    value: email,
    rotateDaily: true,
  })

  const perAccount = await checkRateLimit({
    key: `signin:${fingerprint}:${account}`,
    limit: 10,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!perAccount) return { status: 'error', messageKey: 'rateLimited' }

  const perOrigin = await checkRateLimit({
    key: `signin-origin:${fingerprint}`,
    limit: 30,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!perOrigin) return { status: 'error', messageKey: 'rateLimited' }

  // ---------------------------------------------------------------------------
  // Le compteur qui manquait : les échecs sur CE COMPTE, toutes origines
  // ---------------------------------------------------------------------------
  // Les deux compteurs ci-dessus portent l'empreinte de l'appelant, qui dérive
  // de l'adresse IP. Chaque IP ouvre donc deux seaux neufs, et rien ne comptait
  // les essais dirigés contre un compte précis depuis mille origines. Un parc
  // de sorties donnait 40 000 essais de mot de passe par heure sur une adresse
  // ciblée, sans qu'aucun plafond ne soit jamais atteint.
  //
  // Le commentaire ci-dessus annonce fermer « la pulvérisation » — un mot de
  // passe contre des milliers d'adresses. C'est l'attaque INVERSE qui restait
  // ouverte, et c'est la plus courante contre un compte nommé.
  //
  // Le projet appliquait déjà la bonne règle ailleurs : `eraseMyAccountAction`
  // compte par `user.id` sans empreinte, avec ce raisonnement écrit à côté. La
  // porte d'entrée principale était la seule à ne pas l'avoir.
  //
  // Trois précautions, et chacune répond à un défaut que le remède pourrait
  // créer :
  //
  //  - le refus rend `invalidCredentials`, le MÊME message qu'un mot de passe
  //    faux. Répondre « trop de tentatives » ferait du compteur un oracle : on
  //    saurait que ce compte existe, et on verrait le verrouillage opérer ;
  //
  //  - le plafond est généreux. Cinquante échecs par heure laissent passer
  //    n'importe quel usage humain, y compris derrière le NAT d'une entreprise
  //    où plusieurs personnes partagent une sortie ;
  //
  //  - il est REMIS À ZÉRO par une connexion réussie (voir plus bas). Sans
  //    cela, il compterait les tentatives et non les échecs consécutifs, et
  //    finirait par refuser quelqu'un qui n'a rien fait de mal.
  //
  // Ce qui reste possible, et qui est assumé : brûler cinquante échecs sur une
  // adresse pour en fermer la connexion par mot de passe pendant une heure. La
  // personne n'est pas pour autant dehors — le lien magique et la
  // réinitialisation restent ouverts, et aucun des deux ne dépend de ce
  // compteur.
  const accountKey = `signin-account:${account}`
  const accountAttempts = await checkRateLimit({
    key: accountKey,
    limit: 50,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!accountAttempts) return { status: 'error', messageKey: 'invalidCredentials' }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, bannedAt: true },
  })

  const valid = await verifyPassword(user?.passwordHash, password)

  if (!user || !valid) {
    return { status: 'error', messageKey: 'invalidCredentials' }
  }

  // Le mot de passe est le bon : le compteur d'échecs repart de zéro. C'est ce
  // qui l'empêche de se retourner contre la personne qu'il protège.
  await clearRateLimit(accountKey)
  if (user.bannedAt) {
    return { status: 'error', messageKey: 'banned' }
  }

  await createDatabaseSession(user.id)
  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  })

  // Reprise de ce qui a été déposé depuis ce navigateur avant la connexion,
  // puis renouvellement du jeton : sur un poste partagé, la personne suivante
  // ne doit pas hériter de ce que la précédente avait mis de côté.
  // `email` et non une relecture en base : c'est l'adresse avec laquelle la
  // personne vient de s'authentifier, donc exactement celle qui doit décider
  // du rattachement des commandes passées sans compte.
  await adoptGuestSession(user.id, email)

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

  const byOrigin = await checkRateLimit({
    key: `magic:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!byOrigin) return { status: 'error', messageKey: 'rateLimited' }

  // Compter par IP seulement laissait une porte ouverte : un pool de proxys
  // suffisait à noyer la boîte d'une personne ciblée sous des courriels
  // LÉGITIMEMENT signés par notre domaine. Le coût ne serait pas pour elle
  // seule — plaintes pour spam chez Resend, mise en quarantaine de l'adresse
  // d'envoi, et plus aucun e-mail transactionnel délivré à personne.
  //
  // Le compteur porte sur un jeton, jamais sur l'adresse en clair : la clé
  // part chez un tiers.
  const byAddress = await checkRateLimit({
    key: `magic-mail:${pseudonymize({
      purpose: 'rate-limit:magic-email',
      value: mailboxIdentity(parsed.data.email),
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
  // Réponse inchangée : refuser plus explicitement ici rétablirait l'oracle
  // que le message uniforme ci-dessous a précisément pour but de fermer.
  if (!byAddress) return { status: 'magic-link-sent' }

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
