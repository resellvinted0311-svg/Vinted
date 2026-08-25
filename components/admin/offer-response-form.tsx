'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
  hasAccount,
}: {
  offerId: string
  /** Décidé côté serveur : le composant ne connaît pas le plancher. */
  belowFloor: boolean
  /**
   * L'offre est-elle portée par un compte ?
   *
   * La contre-proposition n'est proposée que dans ce cas. `respondToOffer` la
   * refuse sur une offre déposée sans compte — le registre des offres vit sous
   * `/compte`, donc une invitée n'aurait aucun écran où y répondre et resterait
   * bloquée sur cette pièce jusqu'à l'échéance. Afficher un bouton que le
   * serveur refusera ferait croire au vendeur qu'il a répondu.
   */
  hasAccount: boolean
}) {
  const t = useTranslations('admin.respond')
  const [state, formAction] = useActionState(respondToOfferAction, INITIAL)
  const [confirmed, setConfirmed] = useState(false)
  const [counter, setCounter] = useState('')

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

      {/*
        Le champ de contre-proposition n'apparaît que là où le geste est
        possible. Le serveur borne le montant — strictement au-dessus de
        l'offre reçue, strictement sous le prix affiché — et relit le plancher
        lui-même : rien de tout cela ne traverse le navigateur.
      */}
      {hasAccount ? (
        <Field hint={t('counterHint')}>
          <FieldLabel optional>{t('counterLabel')}</FieldLabel>
          <Input
            name="counterAmountEuros"
            value={counter}
            onChange={(event) => {
              setCounter(event.target.value)
            }}
            // `inputMode` et non `type="number"` : les compteurs n'ont aucun
            // sens sur un prix, et Safari refuse la virgule décimale que tape
            // une personne francophone. La conversion se fait serveur.
            inputMode="decimal"
            autoComplete="off"
          />
        </Field>
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
        {hasAccount ? (
          <SubmitButton
            action="counter"
            label={t('counter')}
            variant="outline"
            // Un montant vide n'est pas une contre-proposition.
            blocked={counter.trim() === ''}
          />
        ) : null}
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
  action: 'accept' | 'reject' | 'counter'
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
