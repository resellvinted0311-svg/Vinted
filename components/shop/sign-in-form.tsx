'use client'

import { useActionState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/lib/i18n/navigation'
import { useEffect } from 'react'
import {
  signInAction,
  magicLinkAction,
  type AuthActionState,
} from '@/lib/auth/actions'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const initialState: AuthActionState = { status: 'idle' }

export function SignInForm() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  )
  const [magicState, magicAction, magicPending] = useActionState(
    magicLinkAction,
    initialState,
  )

  useEffect(() => {
    if (state.status === 'success') {
      // `suite` est posé par le middleware quand une page protégée a été
      // demandée sans session.
      const next = searchParams.get('suite')
      router.replace(next && next.startsWith('/') ? next : '/compte')
      router.refresh()
    }
  }, [state.status, router, searchParams])

  const error =
    state.status === 'error'
      ? state.messageKey
      : magicState.status === 'error'
        ? magicState.messageKey
        : null

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-4">
        <Field error={error ? t(`errors.${error}`) : undefined}>
          <FieldLabel>{t('email')}</FieldLabel>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            inputMode="email"
          />
        </Field>

        <Field>
          <FieldLabel>{t('password')}</FieldLabel>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" disabled={pending} fullWidth>
          {t('submitSignIn')}
        </Button>
      </form>

      <div className="border-t border-sand pt-6">
        <form action={magicAction} className="flex flex-col gap-3">
          <input type="hidden" name="locale" value={locale} />
          <Field
            hint={
              magicState.status === 'magic-link-sent'
                ? t('magicLinkSent')
                : undefined
            }
          >
            <FieldLabel>{t('email')}</FieldLabel>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>

          <Button
            type="submit"
            variant="outline"
            disabled={magicPending}
            fullWidth
          >
            {t('magicLink')}
          </Button>
        </form>
      </div>
    </div>
  )
}
