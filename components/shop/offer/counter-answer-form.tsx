'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations, useLocale } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { formatDate } from '@/lib/utils/format'
import {
  answerCounterAction,
  type CounterActionState,
} from '@/lib/shop/offer-actions'

/**
 * Accepter ou décliner la contre-proposition de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Les deux boutons sont côte à côte, et « décliner » n'est pas caché
 * ---------------------------------------------------------------------------
 * Une contre-proposition bloque la personne sur cette pièce tant qu'elle
 * attend : `already-pending` lui interdit d'en déposer une autre. Décliner est
 * donc le geste qui la LIBÈRE, pas un abandon — et l'enterrer derrière un lien
 * discret la laisserait attendre l'échéance sans savoir qu'elle peut en sortir.
 *
 * Décliner ne déclenche aucun délai de carence : celle-ci ne s'applique qu'aux
 * offres qu'elle a faites et que la boutique a refusées, jamais à une
 * proposition du vendeur qu'elle décline (voir `lib/shop/offers.ts`).
 *
 * ---------------------------------------------------------------------------
 * Aucun montant ne traverse
 * ---------------------------------------------------------------------------
 * Le formulaire n'envoie qu'un identifiant de ligne et un verbe. Le prix est
 * celui que la boutique a inscrit, relu en base au moment d'agir : laisser
 * passer un montant ici reviendrait à laisser choisir son prix.
 */

const INITIAL: CounterActionState = { status: 'idle' }

export function CounterAnswerForm({ counterOfferId }: { counterOfferId: string }) {
  const t = useTranslations('offers')
  const locale = useLocale()
  const [state, formAction] = useActionState(answerCounterAction, INITIAL)

  if (state.status === 'done') {
    return (
      <Notice tone={state.accepted ? 'success' : 'neutral'} role="status">
        <p>
          {state.accepted
            ? t('counterAccepted', {
                date: state.priceValidUntil
                  ? formatDate(new Date(state.priceValidUntil), locale)
                  : '',
              })
            : t('counterDeclined')}
        </p>
      </Notice>
    )
  }

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="counterOfferId" value={counterOfferId} />

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`counterErrors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <AnswerButton answer="accept" label={t('acceptCounter')} variant="primary" />
        <AnswerButton answer="decline" label={t('declineCounter')} variant="outline" />
      </div>
    </form>
  )
}

/**
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire : appelé
 * dans le parent, il renverrait toujours `false` et les deux boutons
 * resteraient cliquables pendant l'envoi. Ici, cliquer « accepter » puis
 * « décliner » dans la seconde ne changerait rien en base — la transition est
 * conditionnelle — mais afficherait une erreur au lieu de la confirmation.
 */
function AnswerButton({
  answer,
  label,
  variant,
}: {
  answer: 'accept' | 'decline'
  label: string
  variant: 'primary' | 'outline'
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      name="answer"
      value={answer}
      variant={variant}
      size="sm"
      disabled={pending}
    >
      {label}
    </Button>
  )
}
