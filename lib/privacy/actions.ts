'use server'

import { prisma } from '@/lib/db/client'
import { requireUser, destroyCurrentSession } from '@/lib/auth/session'
import { verifyPassword } from '@/lib/auth/password'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import {
  eraseAccountSchema,
  marketingConsentSchema,
} from '@/lib/validation/privacy'
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

  const parsed = eraseAccountSchema.safeParse({
    confirm: formData.get('confirm'),
    password: readOptional(formData.get('password')),
  })

  // Confirmation explicite : l'opération est irréversible, elle ne doit pas
  // pouvoir partir d'un clic sur un bouton mal placé.
  if (!parsed.success) {
    return { status: 'error', messageKey: 'confirmationRequired' }
  }

  // ---------------------------------------------------------------------------
  // Deux compteurs, et chacun protège d'autre chose
  // ---------------------------------------------------------------------------
  // Par empreinte : l'abus depuis une même origine. Par COMPTE : les essais de
  // mot de passe sur ce compte précis — ce que le premier ne borne pas, un
  // pool de proxys suffisant à le contourner. Sans le second, cette action
  // devient un second oracle de mot de passe, moins surveillé que la page de
  // connexion et dont le succès détruit le compte.
  const byOrigin = await checkRateLimit({
    key: `privacy-erase:${await clientFingerprint()}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!byOrigin) return { status: 'error', messageKey: 'rateLimited' }

  const byAccount = await checkRateLimit({
    key: `privacy-erase-account:${user.id}`,
    limit: 5,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!byAccount) return { status: 'error', messageKey: 'rateLimited' }

  // ---------------------------------------------------------------------------
  // Re-saisie du mot de passe : la seule preuve que la page ne détient pas
  // ---------------------------------------------------------------------------
  // Le mot de la confirmation est expédié au navigateur — il figure dans le
  // bundle client. Ce n'est donc pas une preuve de possession, mais une
  // protection contre la maladresse : n'importe quel script exécuté dans la
  // page le connaît, et la politique de sécurité de contenu n'arrête pas les
  // scripts en ligne. Un `fetch` de même origine suffisait alors à détruire un
  // compte, et le cookie `httpOnly` n'y change rien puisque la requête part du
  // navigateur de la personne visée.
  //
  // Le mot de passe, lui, n'est nulle part dans la page. Il casse cette chaîne.
  //
  // Un compte ouvert par LIEN MAGIQUE n'a pas d'empreinte : il n'y a alors
  // aucun secret à redemander, et exiger d'en créer un pour pouvoir partir
  // serait une porte fermée à clé sur le chemin de la sortie — l'article 12.2
  // demande l'inverse. Ces comptes gardent la confirmation seule, et c'est une
  // limite assumée, écrite ici plutôt que découverte plus tard.
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  })

  if (account?.passwordHash) {
    if (!parsed.data.password) {
      return { status: 'error', messageKey: 'passwordRequired' }
    }
    const ok = await verifyPassword(account.passwordHash, parsed.data.password)
    if (!ok) return { status: 'error', messageKey: 'passwordIncorrect' }
  }

  const result = await eraseAccount(user.id)
  await destroyCurrentSession()

  return { status: 'erased', outcome: result.outcome }
}

function readOptional(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined
  return value === '' ? undefined : value
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

  // Le champ témoin distingue « la personne a décoché » d'« une requête qui ne
  // porte pas ce champ ». Sans lui, les deux étaient un retrait — et un
  // retrait efface `marketingConsentAt`, c'est-à-dire la preuve horodatée que
  // le consentement avait été donné. Une requête tronquée détruisait donc une
  // preuve que ce fichier déclare conserver.
  const parsed = marketingConsentSchema.safeParse({
    form: formData.get('form'),
    marketingConsent: formData.get('marketingConsent') ?? undefined,
  })
  if (!parsed.success) {
    return { status: 'error', messageKey: 'invalidRequest' }
  }

  // Écriture en base : elle a sa limite comme les autres. En production le
  // pool n'accorde qu'une connexion par instance — une boucle sur cette action
  // sérialisait toutes les pages de l'instance derrière ses UPDATE.
  const allowed = await checkRateLimit({
    key: `privacy-consent:${user.id}`,
    limit: 20,
    windowSeconds: 3600,
    sensitive: false,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const granted = parsed.data.marketingConsent === 'on'

  await prisma.user.update({
    where: { id: user.id },
    data: {
      marketingConsent: granted,
      marketingConsentAt: granted ? new Date() : null,
    },
  })

  return { status: 'saved' }
}
