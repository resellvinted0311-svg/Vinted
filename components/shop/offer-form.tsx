'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { formatDate, formatPrice } from '@/lib/utils/format'
import {
  submitOfferAction,
  type OfferActionState,
} from '@/lib/shop/offer-actions'

/**
 * Proposer un prix.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce formulaire N'ENVOIE PAS
 * ---------------------------------------------------------------------------
 * Ni le prix affiché, ni le prix plancher, ni le minimum de la pièce. Un
 * montant de référence qui traverse le navigateur est un montant qu'on peut
 * réécrire, et la seule chose qu'il permettrait serait de déclencher une
 * acceptation automatique en annonçant un prix affiché plus bas qu'il ne l'est.
 *
 * Le serveur relit tout en base au moment de juger.
 *
 * ---------------------------------------------------------------------------
 * L'avertissement n'est pas une formule de prudence
 * ---------------------------------------------------------------------------
 * « Une offre ne met pas la pièce de côté » est affiché AVANT l'envoi, pas
 * dans une note de bas de page après coup. Sur un stock où chaque pièce existe
 * en un seul exemplaire, c'est l'information qui décide : quelqu'un peut payer
 * le prix affiché pendant qu'on attend une réponse, et il vaut mieux le savoir
 * en proposant qu'en l'apprenant.
 *
 * ---------------------------------------------------------------------------
 * Le champ montant reste CONTRÔLÉ
 * ---------------------------------------------------------------------------
 * React 19 réinitialise les entrées non contrôlées d'un `<form action>` à la
 * fin de l'action. Sans cet état, un refus — « trop basse », « déjà une
 * proposition en attente » — viderait la saisie, et il faudrait tout retaper
 * pour corriger de deux euros.
 */

const INITIAL: OfferActionState = { status: 'idle' }

export function OfferForm({
  articleId,
  /** Connectée : l'adresse vient du compte, on ne la redemande pas. */
  signedIn,
}: {
  articleId: string
  signedIn: boolean
}) {
  const t = useTranslations('article.offer')
  const locale = useLocale()

  const [state, formAction] = useActionState(submitOfferAction, INITIAL)
  const [amount, setAmount] = useState('')
  const [email, setEmail] = useState('')

  if (state.status === 'done') {
    return <OfferOutcome state={state} locale={locale} />
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="articleId" value={articleId} />

      <h3 className="label-reg text-ink">{t('title')}</h3>

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>
            {t(`errors.${state.messageKey}`, {
              // Les deux seuls refus qui dépendent du temps portent une date.
              // Les autres l'ignorent : ICU laisse un argument inutilisé sans
              // broncher, et le fournir toujours évite une branche par message.
              date: state.retryAt
                ? formatDate(new Date(state.retryAt), locale)
                : '',
            })}
          </p>
        </Notice>
      ) : null}

      <Field hint={t('amountHint')}>
        <FieldLabel>{t('amountLabel')}</FieldLabel>
        <Input
          name="amountEuros"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          // `inputMode="decimal"` et non `type="number"` : les compteurs d'un
          // champ numérique n'ont aucun sens sur un prix, et Safari refuse la
          // virgule décimale que tape une personne francophone. La conversion
          // se fait côté serveur, sur la chaîne.
          inputMode="decimal"
          autoComplete="off"
          required
        />
      </Field>

      {signedIn ? null : (
        <Field hint={t('emailHint')}>
          <FieldLabel>{t('emailLabel')}</FieldLabel>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
        </Field>
      )}

      <p className="text-xs text-muted">{t('noHold')}</p>

      <SubmitButton label={t('submit')} />
    </form>
  )
}

/**
 * Bouton d'envoi.
 *
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire : appelé
 * dans `OfferForm`, il renverrait toujours `false`, et le bouton resterait
 * cliquable pendant l'envoi — donc doublement cliquable.
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" fullWidth disabled={pending}>
      {label}
    </Button>
  )
}

/**
 * Ce que devient la proposition.
 *
 * Trois issues, trois messages. Les rabattre sur « proposition envoyée »
 * ferait dire la même chose à une offre acceptée et à une offre refusée sur-
 * le-champ, qui appellent pourtant deux gestes opposés.
 */
function OfferOutcome({
  state,
  locale,
}: {
  state: Extract<OfferActionState, { status: 'done' }>
  locale: string
}) {
  const t = useTranslations('article.offer')
  const amount = formatPrice(state.amountCents, locale)

  if (state.outcome === 'auto-rejected') {
    return (
      <Notice tone="warning" role="status">
        <p>{t('autoRejected', { amount })}</p>
      </Notice>
    )
  }

  if (state.outcome === 'auto-accepted') {
    return (
      <Notice tone="success" role="status">
        <p>
          {t('autoAccepted', {
            amount,
            date: state.priceValidUntil
              ? formatDate(new Date(state.priceValidUntil), locale)
              : '',
          })}
        </p>
        <p className="mt-2 text-xs text-muted">{t('noHold')}</p>
      </Notice>
    )
  }

  return (
    <Notice tone="neutral" role="status">
      <p>
        {t('pending', {
          amount,
          date: formatDate(new Date(state.expiresAt), locale),
        })}
      </p>
      {/* Répété ici, et ce n'est pas une redondance : c'est au moment de
          l'attente que l'information compte le plus. */}
      <p className="mt-2 text-xs text-muted">{t('noHold')}</p>
    </Notice>
  )
}
