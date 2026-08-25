'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Notice } from '@/components/ui/notice'
import {
  respondToOfferAction,
  type AdminOfferActionState,
} from '@/lib/admin/offer-actions'

/**
 * Accepter ou refuser une offre.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce formulaire N'ENVOIE PAS
 * ---------------------------------------------------------------------------
 * Ni le montant de l'offre, ni le prix affiché, ni le prix plancher. Un
 * identifiant, une action, et le cas échéant une case cochée. Tout le reste est
 * relu en base au moment de décider — y compris le franchissement du plancher,
 * que le serveur CONSTATE plutôt que de le croire.
 *
 * ---------------------------------------------------------------------------
 * La case « sous le prix plancher » n'est pas un avertissement de politesse
 * ---------------------------------------------------------------------------
 * Vendre à perte est une décision commerciale, et elle appartient au vendeur —
 * le domaine ne l'interdit pas. Mais elle laisse une trace en base
 * (`Offer.acceptedBelowFloor`), et cette trace ne vaut que si un geste
 * délibéré l'a précédée. Sans cette case, elle enregistrerait un clic distrait
 * comme une décision assumée.
 *
 * Elle n'apparaît que sur les offres réellement concernées : la poser partout
 * la ferait cocher par habitude, ce qui reviendrait à ne pas l'avoir.
 *
 * ---------------------------------------------------------------------------
 * Deux boutons, pas une liste déroulante
 * ---------------------------------------------------------------------------
 * `name="action"` sur chaque `<button type="submit">` : la valeur soumise est
 * celle du bouton pressé. Une liste déroulante suivie d'un bouton « Valider »
 * demanderait deux gestes pour une décision binaire, et laisserait un état
 * intermédiaire où l'écran affiche « accepter » sans que rien ne soit fait.
 */

const INITIAL: AdminOfferActionState = { status: 'idle' }

export function OfferResponseForm({
  offerId,
  belowFloor,
}: {
  offerId: string
  /** Décidé côté serveur : le composant ne connaît pas le plancher. */
  belowFloor: boolean
}) {
  const t = useTranslations('admin.respond')
  const [state, formAction] = useActionState(respondToOfferAction, INITIAL)
  const [confirmed, setConfirmed] = useState(false)

  if (state.status === 'done') {
    return (
      <Notice tone={state.outcome === 'accepted' ? 'success' : 'neutral'} role="status">
        <p>{t(state.outcome)}</p>
      </Notice>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="offerId" value={offerId} />

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`errors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      {belowFloor ? (
        <Checkbox
          name="confirmBelowFloor"
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.target.checked)
          }}
          label={t('confirmBelowFloor')}
          hint={t('confirmBelowFloorHint')}
        />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SubmitButton
          action="accept"
          label={t('accept')}
          // Sur une offre sous le plancher, le bouton attend la case. Le
          // serveur refuserait de toute façon — c'est lui qui fait autorité —
          // mais laisser cliquer pour se voir refuser n'apprend rien.
          blocked={belowFloor && !confirmed}
        />
        <SubmitButton action="reject" label={t('reject')} variant="outline" />
      </div>
    </form>
  )
}

/**
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire : appelé
 * dans le parent, il renverrait toujours `false`, et les boutons resteraient
 * cliquables pendant l'envoi — donc doublement cliquables.
 */
function SubmitButton({
  action,
  label,
  variant = 'primary',
  blocked = false,
}: {
  action: 'accept' | 'reject'
  label: string
  variant?: 'primary' | 'outline'
  blocked?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      name="action"
      value={action}
      variant={variant}
      size="sm"
      disabled={pending || blocked}
    >
      {label}
    </Button>
  )
}
