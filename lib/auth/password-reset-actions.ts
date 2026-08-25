'use server'

import { prisma } from '@/lib/db/client'
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '@/lib/validation/auth'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
import { mailboxIdentity } from '@/lib/security/mail-identity'
import { isAuthConfigured } from '@/lib/config/site'
import { sendPasswordResetEmail } from '@/lib/providers/email/password-reset'
import { captureException } from '@/lib/observability/sentry'
import {
  openPasswordReset,
  consumePasswordReset,
  logResetRequested,
} from './password-reset'
import { createDatabaseSession } from './session'

/**
 * Réinitialisation de mot de passe — les deux actions serveur.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte que les deux gestes destinés à l'être, et rien
 * de ce qui touche `UserToken` ne transite par ici — c'est
 * `lib/auth/password-reset.ts` qui le fait, et il n'est pas une action.
 *
 * ---------------------------------------------------------------------------
 * La réponse est la MÊME que le compte existe ou non
 * ---------------------------------------------------------------------------
 * C'est la règle déjà tenue par la connexion et par le lien magique. La
 * respecter ici demande de la tenir jusqu'au bout, y compris dans les cas
 * qu'on n'a pas envie de traiter :
 *
 *  - adresse inconnue → même réponse, même délai apparent ;
 *  - compte anonymisé → même réponse, et aucun e-mail : poser un mot de passe
 *    sur une pierre tombale la ferait revivre ;
 *  - compte sans mot de passe (créé par lien magique) → un mot de passe EST
 *    posé, et c'est voulu. Refuser dirait « ce compte existe mais sans mot de
 *    passe », ce qui en apprend plus que de ne rien dire. Et la personne est
 *    bien la titulaire de la boîte, puisqu'elle a reçu le lien ;
 *  - plafond de débit atteint → même réponse. Refuser plus explicitement ici
 *    rétablirait l'oracle que le message uniforme ferme.
 *
 * L'inscription, elle, révèle toujours l'existence d'un compte — c'est une
 * décision assumée, écrite dans DEPLOY.md. Ce n'est pas une raison d'ouvrir
 * une seconde porte : la première a un coût de conversion qui la justifie,
 * celle-ci n'en aurait aucun.
 */

export type PasswordResetState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  /** Volontairement indistinct de l'échec : voir l'en-tête. */
  | { status: 'sent' }
  | { status: 'done' }

/**
 * Demande d'un lien de réinitialisation.
 */
export async function requestPasswordResetAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  // Sans secret de signature, la session qui suivra la réinitialisation ne
  // vaudrait rien : la personne poserait un mot de passe puis se retrouverait
  // déconnectée sans comprendre. Mieux vaut ne rien écrire et le dire.
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
  })
  if (!parsed.success) return { status: 'error', messageKey: 'invalidEmail' }

  const byOrigin = await checkRateLimit({
    key: `password-reset:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!byOrigin) return { status: 'error', messageKey: 'rateLimited' }

  // Compter par empreinte d'appelant SEULEMENT laisserait une porte ouverte :
  // un parc de sorties suffirait à noyer la boîte d'une personne ciblée sous
  // des courriels légitimement signés par notre domaine. Le coût ne serait pas
  // pour elle seule — plaintes pour spam chez le prestataire, mise en
  // quarantaine de l'adresse d'envoi, et plus aucun e-mail transactionnel
  // délivré à personne.
  //
  // Le compteur porte sur un JETON, jamais sur l'adresse en clair : la clé
  // part chez un tiers.
  const byAddress = await checkRateLimit({
    key: `password-reset-mail:${pseudonymize({
      purpose: 'rate-limit:password-reset-email',
      value: mailboxIdentity(parsed.data.email),
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!byAddress) return { status: 'sent' }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, anonymizedAt: true },
  })

  // Inconnue, ou effacée : on s'arrête, et on répond comme si de rien n'était.
  if (!user || user.anonymizedAt) return { status: 'sent' }

  const request = await openPasswordReset(user.id, parsed.data.locale)
  logResetRequested(user.id)

  try {
    await sendPasswordResetEmail({
      to: parsed.data.email,
      url: request.url,
      expires: request.expiresAt,
    })
  } catch (error) {
    // L'envoi a échoué. On le remonte — un lien de réinitialisation qui ne
    // part jamais est une personne enfermée dehors — mais la réponse reste la
    // même : dire « l'envoi a échoué » confirmerait qu'il y avait quelque
    // chose à envoyer, donc qu'un compte existe.
    await captureException(error, {
      event: 'password_reset.email_failed',
      fields: { userId: user.id },
    })
  }

  return { status: 'sent' }
}

/**
 * Pose du nouveau mot de passe.
 *
 * ---------------------------------------------------------------------------
 * Le jeton est consommé ICI, à l'envoi du formulaire — jamais à l'ouverture
 * ---------------------------------------------------------------------------
 * Les filtres antivirus des messageries d'entreprise suivent les liens des
 * messages entrants pour les inspecter. Un jeton consommé au rendu de la page
 * serait brûlé avant que la personne n'ait cliqué : elle recevrait « ce lien
 * n'est plus valide » sur un lien qu'elle n'a jamais ouvert.
 */
export async function resetPasswordAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.path[0] === 'password') {
      return { status: 'error', messageKey: 'passwordTooShort' }
    }
    return { status: 'error', messageKey: 'invalidLink' }
  }

  // Compteur sur le porteur du lien, pas sur le jeton : le jeton est unique et
  // à usage unique, il n'y a rien à marteler dessus. Ce qui se martèle, c'est
  // la DEVINETTE — envoyer des jetons au hasard pour tomber sur un valide. La
  // borne rend l'exercice sans objet, en plus des 256 bits d'entropie.
  const allowed = await checkRateLimit({
    key: `password-reset-submit:${await clientFingerprint()}`,
    limit: 10,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const outcome = await consumePasswordReset(parsed.data.token, parsed.data.password)

  if (!outcome.ok) {
    // Les quatre refus se disent d'une seule façon : « ce lien n'est plus
    // valide, demandez-en un autre ». Distinguer « inconnu » de « expiré »
    // apprendrait à qui tâtonne si son jeton a un jour existé.
    return { status: 'error', messageKey: 'invalidLink' }
  }

  // Toutes les sessions ont été détruites par la consommation, y compris celle
  // de la personne si elle était connectée. On lui en ouvre une nouvelle : elle
  // vient de prouver qu'elle tient la boîte et de choisir un mot de passe,
  // c'est le moment où elle est le plus authentifiée de toute sa visite.
  await createDatabaseSession(outcome.userId)

  return { status: 'done' }
}
