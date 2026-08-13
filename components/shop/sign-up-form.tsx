'use client'

import { useActionState, useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/lib/i18n/navigation'
import { signUpAction, type AuthActionState } from '@/lib/auth/actions'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const initialState: AuthActionState = { status: 'idle' }

export function SignUpForm() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const [state, formAction, pending] = useActionState(signUpAction, initialState)

  useEffect(() => {
    if (state.status === 'success') {
      router.replace('/compte')
      router.refresh()
    }
  }, [state.status, router])

  const error = state.status === 'error' ? state.messageKey : null

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel optional>{t('firstName')}</FieldLabel>
          <Input name="firstName" autoComplete="given-name" />
        </Field>

        <Field>
          <FieldLabel optional>{t('lastName')}</FieldLabel>
          <Input name="lastName" autoComplete="family-name" />
        </Field>
      </div>

      <Field error={error ? t(`errors.${error}`) : undefined}>
        <FieldLabel>{t('email')}</FieldLabel>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field hint={t('passwordHint')}>
        <FieldLabel>{t('password')}</FieldLabel>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>

      {/* Consentement marketing : distinct des CGV, jamais pré-coché. */}
      <label className="flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          name="marketingConsent"
          className="mt-0.5 h-4 w-4 accent-[var(--stamp)]"
        />
        <span>{t('marketingConsent')}</span>
      </label>

      <Button type="submit" disabled={pending} fullWidth>
        {t('submitSignUp')}
      </Button>
    </form>
  )
}
