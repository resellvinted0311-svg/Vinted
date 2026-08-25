'use client'

import { useActionState, useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { useRouter } from '@/lib/i18n/navigation'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import {
  requestPasswordResetAction,
  resetPasswordAction,
  type PasswordResetState,
} from '@/lib/auth/password-reset-actions'

const INITIAL: PasswordResetState = { status: 'idle' }

/**
 * Les deux écrans de la réinitialisation.
 *
 * ---------------------------------------------------------------------------
 * La demande ne dit JAMAIS si le compte existe
 * ---------------------------------------------------------------------------
 * Le message de confirmation est volontairement au conditionnel — « si un
 * compte existe pour cette adresse » — et il s'affiche à l'identique quand
 * l'adresse est inconnue, quand le compte a été effacé, et quand le plafond
 * d'envois est atteint. C'est la même règle que celle déjà tenue par la
 * connexion et le lien magique ; la tenir à moitié revient à ne pas la tenir.
 */
export function PasswordResetRequestForm() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    INITIAL,
  )

  if (state.status === 'sent') {
    return (
      <Notice tone="success" role="status">
        <p>{t('reset.sent')}</p>
      </Notice>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      <Field
        error={
          state.status === 'error' ? t(`errors.${state.messageKey}`) : undefined
        }
        hint={t('reset.requestHint')}
      >
        <FieldLabel>{t('email')}</FieldLabel>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {t('reset.submitRequest')}
      </Button>
    </form>
  )
}

/**
 * Le choix du nouveau mot de passe.
 *
 * ---------------------------------------------------------------------------
 * Le jeton voyage en champ caché, et il n'est consommé qu'ICI
 * ---------------------------------------------------------------------------
 * L'ouverture de la page ne fait que vérifier le lien. C'est l'envoi de ce
 * formulaire qui le consomme — sans quoi les filtres antivirus des messageries
 * d'entreprise, qui suivent les liens entrants pour les inspecter, brûleraient
 * le jeton avant que la personne n'ait cliqué.
 *
 * `autoComplete="new-password"` et non `current-password` : le gestionnaire de
 * mots de passe doit PROPOSER d'en générer un, pas remplir l'ancien — qui est
 * précisément celui qu'on remplace.
 */
export function PasswordResetForm({ token }: { token: string }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL)

  useEffect(() => {
    if (state.status !== 'done') return
    // La session a été ouverte par l'action : toutes les précédentes ont été
    // détruites, y compris celle d'un éventuel intrus. `refresh()` fait relire
    // l'en-tête, qui affichait encore « se connecter ».
    router.replace('/compte')
    router.refresh()
  }, [state.status, router])

  if (state.status === 'done') {
    return (
      <Notice tone="success" role="status">
        <p>{t('reset.done')}</p>
      </Notice>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      <Field
        error={
          state.status === 'error' ? t(`errors.${state.messageKey}`) : undefined
        }
        hint={t('passwordHint')}
      >
        <FieldLabel>{t('reset.newPassword')}</FieldLabel>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {t('reset.submitSet')}
      </Button>
    </form>
  )
}
