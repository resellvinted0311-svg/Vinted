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

export type WithdrawalState =
  | { status: 'idle' }
  | {
      status: 'error'
      messageKey: 'invalid' | 'rateLimited' | 'securityUnavailable'
    }
  /**
   * Transmise. Volontairement indistinct de « rien ne correspond ».
   *
   * L'instant est celui du SERVEUR, rendu à l'écran : c'est la date et l'heure
   * que la personne pourra opposer, et elles ne doivent pas dépendre de
   * l'horloge de son téléphone.
   */
  | { status: 'sent'; submittedAt: string; email: string }

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

async function submitWithdrawal(formData: FormData): Promise<WithdrawalState> {
  const parsed = withdrawalSchema.safeParse({
    name: formData.get('name'),
    orderNumber: formData.get('orderNumber'),
    email: formData.get('email'),
    locale: formData.get('locale'),
  })
  if (!parsed.success) return { status: 'error', messageKey: 'invalid' }

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
    }
  }

  const sent: WithdrawalState = {
    status: 'sent',
    submittedAt: new Date().toISOString(),
    email: parsed.data.email,
  }

  // Par adresse aussi, et pour la raison de « mot de passe oublié » : un parc
  // de connexions suffirait sinon à noyer la boîte d'une acheteuse sous des
  // accusés légitimement signés par notre domaine. Au-delà, on répond comme
  // si de rien n'était — et rien ne part.
  const byAddress = await checkRateLimit({
    key: `withdrawal-mail:${pseudonymize({
      purpose: 'rate-limit:withdrawal-email',
      value: mailboxIdentity(parsed.data.email),
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!byAddress) return sent

  const { jobIds } = await recordWithdrawal(parsed.data)
  pousserApresReponse(jobIds)

  return sent
}
