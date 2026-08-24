'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/lib/i18n/navigation'
import {
  eraseMyAccountAction,
  setMarketingConsentAction,
  type PrivacyActionState,
} from '@/lib/privacy/actions'
import {
  ERASE_CONFIRMATION_WORD,
  MARKETING_CONSENT_FORM,
} from '@/lib/validation/privacy'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const initialState: PrivacyActionState = { status: 'idle' }

/**
 * Consentement marketing, retirable en un geste.
 *
 * La case est enregistrée à la soumission, pas au clic : un basculement
 * silencieux laisserait planer le doute sur ce qui a réellement été retenu, et
 * c'est un consentement — il doit être explicite dans les deux sens.
 */
export function MarketingConsentForm({ granted }: { granted: boolean }) {
  const t = useTranslations('privacy.myData')
  const [state, formAction, pending] = useActionState(
    setMarketingConsentAction,
    initialState,
  )

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {/*
        Champ témoin, toujours envoyé. Une case décochée n'est PAS transmise
        par le navigateur : sans lui, le serveur ne pouvait pas distinguer un
        retrait délibéré d'une requête qui ne porte simplement pas ce champ —
        et il traitait les deux comme un retrait, ce qui efface la preuve
        horodatée du consentement.
      */}
      <input type="hidden" name="form" value={MARKETING_CONSENT_FORM} />

      <label className="flex items-start gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="marketingConsent"
          defaultChecked={granted}
          className="mt-0.5 h-4 w-4 accent-[var(--stamp)]"
        />
        <span>{granted ? t('consentOn') : t('consentOff')}</span>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t('consentTitle')}
        </Button>
        {state.status === 'saved' ? (
          <span className="text-xs text-muted" role="status">
            ✓
          </span>
        ) : null}
      </div>
    </form>
  )
}

/**
 * Effacement du compte.
 *
 * Le mot à recopier est demandé côté client ET revérifié côté serveur : la
 * vérification côté client n'est qu'un garde-fou d'interface, celle qui compte
 * est la seconde.
 */
export function EraseAccountForm() {
  const t = useTranslations('privacy.myData')
  const router = useRouter()
  const [confirm, setConfirm] = useState('')
  const [state, formAction, pending] = useActionState(
    eraseMyAccountAction,
    initialState,
  )

  useEffect(() => {
    if (state.status === 'erased') {
      // La session est déjà refermée côté serveur : on recharge pour que
      // l'en-tête et les pages protégées le constatent.
      router.refresh()
    }
  }, [state.status, router])

  if (state.status === 'erased') {
    return (
      <p className="text-base text-ink" role="status">
        {state.outcome === 'deleted'
          ? t('erasedDeleted')
          : t('erasedAnonymized')}
      </p>
    )
  }

  const error = state.status === 'error' ? state.messageKey : null

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field error={error ? t(`errors.${error}`) : undefined}>
        <FieldLabel>{t('eraseConfirmLabel')}</FieldLabel>
        <Input
          name="confirm"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value)
          }}
          autoComplete="off"
          required
        />
      </Field>

      {/*
        La re-saisie du mot de passe est le seul secret que la page ne détient
        pas : le mot de confirmation, lui, voyage dans le bundle. Le champ est
        facultatif côté client — un compte ouvert par lien magique n'a pas
        d'empreinte — et c'est le serveur qui tranche, en regardant s'il en
        existe une.
      */}
      <Field hint={t('erasePasswordHint')}>
        <FieldLabel>{t('erasePasswordLabel')}</FieldLabel>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
        />
      </Field>

      <Button
        type="submit"
        variant="danger"
        disabled={pending || confirm !== ERASE_CONFIRMATION_WORD}
      >
        {t('eraseButton')}
      </Button>
    </form>
  )
}
