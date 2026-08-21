'use server'

import { prisma } from '@/lib/db/client'
import { requireUser, destroyCurrentSession } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { eraseAccount } from './anonymize'

/**
 * Exercice des droits, depuis l'espace personnel.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` rend PUBLIC tout ce qu'il exporte. Sur un fichier qui efface
 * des comptes, la règle n'admet aucune exception : l'identité de l'appelant
 * vient de la SESSION, jamais d'un paramètre. Aucune de ces fonctions ne prend
 * d'identifiant de compte — c'est délibéré, et cela doit le rester.
 *
 * La copie des données, elle, n'est pas ici : c'est un vrai téléchargement,
 * servi par `app/api/compte/donnees/route.ts`. Un point d'entrée de moins.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi des droits exerçables en ligne plutôt qu'une adresse de contact
 * ---------------------------------------------------------------------------
 * L'article 12.2 demande de « faciliter l'exercice des droits ». Renvoyer vers
 * une boîte aux lettres le rend possible ; le mettre dans l'espace personnel
 * le facilite. La différence compte aussi en pratique : une demande par
 * e-mail suppose de vérifier l'identité du demandeur, ce qui conduit à
 * réclamer une pièce d'identité — donc à collecter DAVANTAGE de données
 * personnelles pour honorer une demande de confidentialité. Une session
 * authentifiée règle la question sans rien collecter.
 */

export type PrivacyActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'saved' }
  | { status: 'erased'; outcome: 'deleted' | 'anonymized' }

/**
 * Effacement du compte — article 17.
 *
 * La session est refermée dans la foulée : laisser un cookie valide pointer
 * sur un compte effacé produirait des pages en erreur et donnerait
 * l'impression que rien ne s'est passé.
 */
export async function eraseMyAccountAction(
  _prev: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> {
  const user = await requireUser()

  // Confirmation explicite : l'opération est irréversible, elle ne doit pas
  // pouvoir partir d'un clic sur un bouton mal placé.
  if (formData.get('confirm') !== 'EFFACER') {
    return { status: 'error', messageKey: 'confirmationRequired' }
  }

  const allowed = await checkRateLimit({
    key: `privacy-erase:${await clientFingerprint()}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const result = await eraseAccount(user.id)
  await destroyCurrentSession()

  return { status: 'erased', outcome: result.outcome }
}

/**
 * Retrait ou renouvellement du consentement marketing — article 7.3.
 *
 * « Il doit être aussi simple de retirer que de donner son consentement. » Il
 * est donné par une case à l'inscription : il se retire par une case ici, pas
 * par un e-mail à envoyer.
 *
 * La date n'est effacée qu'au retrait : tant que le consentement vaut, elle
 * est la preuve qu'il a été donné, et à quel moment.
 */
export async function setMarketingConsentAction(
  _prev: PrivacyActionState,
  formData: FormData,
): Promise<PrivacyActionState> {
  const user = await requireUser()
  const granted = formData.get('marketingConsent') === 'on'

  await prisma.user.update({
    where: { id: user.id },
    data: {
      marketingConsent: granted,
      marketingConsentAt: granted ? new Date() : null,
    },
  })

  return { status: 'saved' }
}
