'use client'

import { useActionState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import {
  submitWithdrawalAction,
  type WithdrawalState,
} from '@/lib/shop/withdrawal-actions'
import { formatDateTime } from '@/lib/utils/format'

const INITIAL: WithdrawalState = { status: 'idle' }

/**
 * Le formulaire de la fonction « Renoncer au contrat ici ».
 *
 * ---------------------------------------------------------------------------
 * Trois champs, et le bouton porte les mots de la loi
 * ---------------------------------------------------------------------------
 * Le nom, le numéro de commande, l'adresse de l'accusé : ce que la directive
 * permet de demander, rien de plus. Le bouton dit « Confirmer la
 * rétractation » — c'est la formule du texte, et une formule plus aimable
 * (« Envoyer », « Valider ») ne dirait pas ce qui se passe.
 *
 * ---------------------------------------------------------------------------
 * La confirmation est au conditionnel, et c'est voulu
 * ---------------------------------------------------------------------------
 * « Si ces informations correspondent à une commande » : la page ne dit
 * jamais si un couple numéro + adresse existe. Voir `lib/shop/withdrawal.ts`.
 * L'instant affiché vient du serveur, pas du téléphone.
 */
export function WithdrawalForm({
  initialOrderNumber,
}: {
  initialOrderNumber?: string
}) {
  const t = useTranslations('withdrawal')
  const locale = useLocale()
  const [state, formAction, pending] = useActionState(
    submitWithdrawalAction,
    INITIAL,
  )

  if (state.status === 'sent') {
    return (
      <Notice tone="success" role="status">
        <p className="text-base text-ink">{t('sentTitle')}</p>
        <p className="mt-2">
          {t('sent', {
            date: formatDateTime(new Date(state.submittedAt), locale),
          })}
        </p>
        <p className="mt-2">{t('sentDetail', { email: state.email })}</p>
        <p className="mt-2 text-muted">{t('sentHelp')}</p>
      </Notice>
    )
  }

  const erreur =
    state.status === 'error' ? t(`errors.${state.messageKey}`) : undefined

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      {erreur ? (
        <Notice tone="warning" role="alert">
          <p>{erreur}</p>
        </Notice>
      ) : null}

      <Field>
        <FieldLabel>{t('fields.name')}</FieldLabel>
        <Input
          name="name"
          autoComplete="name"
          minLength={2}
          maxLength={120}
          required
        />
      </Field>

      <Field hint={t('fields.orderNumberHint')}>
        <FieldLabel>{t('fields.orderNumber')}</FieldLabel>
        <Input
          name="orderNumber"
          defaultValue={initialOrderNumber}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="CMD-2026-000123"
          required
        />
      </Field>

      <Field hint={t('fields.emailHint')}>
        <FieldLabel>{t('fields.email')}</FieldLabel>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
