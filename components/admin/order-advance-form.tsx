'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import type { FulfilmentAction } from '@/lib/domain/fulfilment'
import {
  advanceOrderAction,
  type AdminOrderActionState,
} from '@/lib/admin/order-actions'

/**
 * Les gestes possibles sur une commande, et rien d'autre.
 *
 * ---------------------------------------------------------------------------
 * Les boutons viennent du SERVEUR, pas d'un `if` écrit ici
 * ---------------------------------------------------------------------------
 * `availableActions(status)` — le même domaine qui autorise la transition —
 * décide de ce qui s'affiche. Écrire ici « si payée alors préparer et
 * expédier » recopierait la machine à états dans une vue, et les deux
 * finiraient par diverger : on verrait un bouton qui échoue, ou un geste
 * possible que rien ne propose.
 *
 * Le serveur refuse de toute façon ce qui n'est pas permis. Ce que ces boutons
 * apportent est plus modeste et plus utile : ne pas faire cliquer pour rien.
 *
 * ---------------------------------------------------------------------------
 * Le suivi ne se saisit qu'à l'expédition, et il est facultatif
 * ---------------------------------------------------------------------------
 * Les champs n'apparaissent que si « expédier » est possible. Ils restent vides
 * sans empêcher le geste : toutes les expéditions n'ont pas de numéro
 * exploitable, et exiger le champ obligerait à en inventer un — l'acheteuse
 * suivrait alors un colis qui n'existe pas.
 */

const INITIAL: AdminOrderActionState = { status: 'idle' }

export function OrderAdvanceForm({
  orderId,
  actions,
}: {
  orderId: string
  /** Décidé côté serveur par `availableActions`. */
  actions: FulfilmentAction[]
}) {
  const t = useTranslations('admin')
  const [state, formAction] = useActionState(advanceOrderAction, INITIAL)
  const [tracking, setTracking] = useState('')
  const [trackingUrl, setTrackingUrl] = useState('')

  if (state.status === 'done') {
    return (
      <Notice tone="success" role="status">
        <p>{t(`advanced.${state.reached}`)}</p>
      </Notice>
    )
  }

  const canShip = actions.includes('ship')

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`errors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      {canShip ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field hint={t('trackingHint')} className="flex-1">
            <FieldLabel optional>{t('trackingLabel')}</FieldLabel>
            <Input
              name="trackingNumber"
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
              // Un numéro de suivi n'est ni un nom ni une adresse : la
              // complétion automatique du navigateur n'a rien de pertinent à
              // proposer, et proposerait donc autre chose.
              autoComplete="off"
              // Majuscules et chiffres : les claviers mobiles ouvrent sur la
              // bonne disposition. La normalisation reste serveur.
              autoCapitalize="characters"
              spellCheck={false}
            />
          </Field>

          <Field hint={t('trackingUrlHint')} className="flex-1">
            <FieldLabel optional>{t('trackingUrlLabel')}</FieldLabel>
            <Input
              name="trackingUrl"
              type="url"
              value={trackingUrl}
              onChange={(event) => setTrackingUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <SubmitButton
            key={action}
            action={action}
            label={t(action)}
            // L'expédition est le geste qui prévient l'acheteuse : c'est celui
            // qu'on vient faire. Les autres l'accompagnent.
            variant={action === 'ship' ? 'primary' : 'outline'}
          />
        ))}
      </div>
    </form>
  )
}

/**
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire : appelé
 * dans le parent, il renverrait toujours `false`, et les boutons resteraient
 * cliquables pendant l'envoi — donc doublement cliquables. Ici, deux clics sur
 * « Expédier » ne feraient pas partir deux e-mails — la transition est
 * conditionnelle en base — mais afficheraient une erreur au lieu du succès.
 */
function SubmitButton({
  action,
  label,
  variant,
}: {
  action: FulfilmentAction
  label: string
  variant: 'primary' | 'outline'
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      name="action"
      value={action}
      variant={variant}
      size="sm"
      disabled={pending}
    >
      {label}
    </Button>
  )
}
