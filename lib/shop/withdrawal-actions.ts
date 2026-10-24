'use server'

import { withdrawalSchema } from '@/lib/validation/withdrawal'
import { checkRateLimit, rateLimitOutcome } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
import { mailboxIdentity } from '@/lib/security/mail-identity'
import { withTimeFloor } from '@/lib/security/timing'
import { pousserApresReponse } from '@/lib/jobs/push'
import { recordWithdrawal } from './withdrawal'

/**
 * La fonction « Renoncer au contrat ici » — l'action serveur.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * Ce module n'exporte qu'une action, et son corps vit dans une fonction non
 * exportée : un second export serait une seconde porte, qui contournerait le
 * plancher de temps.
 *
 * ---------------------------------------------------------------------------
 * La réponse est la MÊME que la commande existe ou non — le DÉLAI aussi
 * ---------------------------------------------------------------------------
 * Même raisonnement, et mêmes deux gestes, que « mot de passe oublié »
 * (`lib/auth/password-reset-actions.ts`) : les e-mails partent par la file,
 * hors du chemin de réponse, et un plancher de temps commun couvre le résidu
 * d'allers-retours de base qui distingue les branches. Sans cela, une commande
 * existante répondrait plus tard qu'une commande inconnue, et le chronomètre
 * dirait ce que la phrase tait.
 *
 * Le plafond de débit atteint répond, lui, autrement — et c'est assumé : il
 * ne dit rien d'une commande, seulement de la connexion qui insiste.
 */

/**
 * Ce qui a été saisi, rendu tel quel en cas d'erreur.
 *
 * React 19 réinitialise un formulaire après chaque action, réussie ou non : sans
 * ces valeurs, une seule faute de frappe effaçait les trois champs — et une
 * personne qui exerce un droit dans un délai compté recommençait tout.
 */
export interface WithdrawalValues {
  name: string
  orderNumber: string
  email: string
}

export type WithdrawalState =
  | { status: 'idle' }
  | {
      status: 'error'
      messageKey: 'invalid' | 'rateLimited' | 'securityUnavailable'
      values: WithdrawalValues
    }
  /**
   * Transmise. Volontairement indistinct de « rien ne correspond ».
   *
   * L'instant est celui du SERVEUR, rendu à l'écran : c'est la date et l'heure
   * que la personne pourra opposer, et elles ne doivent pas dépendre de
   * l'horloge de son téléphone.
   */
  | { status: 'sent'; submittedAt: string }

/**
 * Plancher de temps de la réponse, en millisecondes.
 *
 * Même valeur, et même justification, que pour la réinitialisation de mot de
 * passe : très au-dessus du travail réel (deux compteurs, une transaction
 * courte), imperceptible pour qui vient de cliquer.
 */
const RESPONSE_FLOOR_MS = 500

export async function submitWithdrawalAction(
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  return withTimeFloor(RESPONSE_FLOOR_MS, () => submitWithdrawal(formData))
}

function texte(formData: FormData, nom: string): string {
  const valeur = formData.get(nom)
  return typeof valeur === 'string' ? valeur.slice(0, 254) : ''
}

async function submitWithdrawal(formData: FormData): Promise<WithdrawalState> {
  const values: WithdrawalValues = {
    name: texte(formData, 'name'),
    orderNumber: texte(formData, 'orderNumber'),
    email: texte(formData, 'email'),
  }

  const parsed = withdrawalSchema.safeParse({
    ...values,
    locale: formData.get('locale'),
  })
  if (!parsed.success) return { status: 'error', messageKey: 'invalid', values }

  const byOrigin = await rateLimitOutcome({
    key: `withdrawal:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 900,
    sensitive: true,
  })
  if (byOrigin !== 'allowed') {
    return {
      status: 'error',
      messageKey:
        byOrigin === 'limited' ? 'rateLimited' : 'securityUnavailable',
      values,
    }
  }

  const sent: WithdrawalState = {
    status: 'sent',
    submittedAt: new Date().toISOString(),
  }

  // Par adresse aussi, pour la raison de « mot de passe oublié » : un parc de
  // connexions suffirait sinon à noyer la boîte d'une acheteuse sous des
  // accusés légitimement signés par notre domaine.
  //
  // Ce plafond borne les RENVOIS d'accusé, jamais l'enregistrement. La
  // première version sortait ici avant d'écrire quoi que ce soit : trois
  // essais avec un mauvais numéro, puis le bon, et la quatrième déclaration —
  // la vraie — était jetée sous « Rétractation transmise ». Le compteur est
  // consulté dans tous les cas, pour que le travail fait ne dépende pas de
  // l'issue.
  const resendAllowed = await checkRateLimit({
    key: `withdrawal-mail:${pseudonymize({
      purpose: 'rate-limit:withdrawal-email',
      value: mailboxIdentity(parsed.data.email),
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })

  const { jobIds } = await recordWithdrawal(parsed.data, { resendAllowed })
  pousserApresReponse(jobIds)

  return sent
}
