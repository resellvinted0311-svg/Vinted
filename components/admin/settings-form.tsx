'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import {
  updateSettingsAction,
  type AdminSettingsState,
} from '@/lib/admin/settings-actions'
import type { EditableSetting } from '@/lib/config/settings'

/**
 * Les réglages métier, à l'écran.
 *
 * ---------------------------------------------------------------------------
 * Les champs viennent du SERVEUR, pas d'une liste écrite ici
 * ---------------------------------------------------------------------------
 * `EDITABLE_SETTINGS` — la même liste fermée que l'action serveur parcourt pour
 * lire le formulaire — décide de ce qui s'affiche et sous quelle forme. Recopier
 * les champs ici ferait diverger les deux : on verrait un champ que le serveur
 * ignore, ou un réglage éditable que rien ne propose.
 *
 * ---------------------------------------------------------------------------
 * Tout est renvoyé, y compris ce qu'on n'a pas touché
 * ---------------------------------------------------------------------------
 * Un formulaire HTML envoie tous ses champs. L'action reçoit donc la
 * configuration ENTIÈRE et la réécrit d'un bloc, ce qui évite le défaut des
 * enregistrements partiels : deux onglets ouverts, chacun enregistrant « son »
 * champ, produiraient une configuration que personne n'a voulue. Ici le dernier
 * enregistrement fait foi, en entier, et il est consigné à la piste d'audit.
 */

const INITIAL: AdminSettingsState = { status: 'idle' }

/** Ce que la page a lu en base, sous forme de chaînes prêtes à afficher. */
export interface SettingsFormValues {
  [key: string]: string
}

export function SettingsForm({
  fields,
  values,
  profile,
}: {
  fields: readonly EditableSetting[]
  values: SettingsFormValues
  /** `development` tant que personne n'a enregistré de vraies valeurs. */
  profile: 'development' | 'production'
}) {
  const t = useTranslations('admin.settings')
  const [state, formAction] = useActionState(updateSettingsAction, INITIAL)

  const groups = [...new Set(fields.map((field) => field.group))]

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {profile === 'development' ? (
        <Notice tone="warning" role="status">
          <p>{t('demoProfile')}</p>
        </Notice>
      ) : null}

      {state.status === 'done' ? (
        <Notice tone="success" role="status">
          <p>{t('saved', { count: state.changed })}</p>
        </Notice>
      ) : null}

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>
            {state.key
              ? t('errorOnField', { field: t(`fields.${state.key}.label`) })
              : t(`errors.${state.messageKey}`)}
          </p>
        </Notice>
      ) : null}

      {groups.map((group) => (
        <fieldset key={group} className="flex flex-col gap-4">
          <legend className="text-sm uppercase tracking-wide">
            {t(`groups.${group}`)}
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            {fields
              .filter((field) => field.group === group)
              .map((field) => (
                <SettingField
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ''}
                />
              ))}
          </div>
        </fieldset>
      ))}

      <SubmitButton label={t('save')} />
    </form>
  )
}

function SettingField({
  field,
  value,
}: {
  field: EditableSetting
  value: string
}) {
  const t = useTranslations('admin.settings')
  const label = t(`fields.${field.key}.label`)
  const hint = t(`fields.${field.key}.hint`)

  if (field.kind === 'boolean') {
    return (
      <Field hint={hint}>
        <FieldLabel>{label}</FieldLabel>
        <input
          type="checkbox"
          name={field.key}
          defaultChecked={value === 'true'}
          className="size-5 accent-[var(--color-ink)]"
        />
      </Field>
    )
  }

  if (field.kind === 'dropSchedule') {
    return (
      <Field hint={hint} className="sm:col-span-2">
        <FieldLabel>{label}</FieldLabel>
        <textarea
          name={field.key}
          defaultValue={value}
          rows={4}
          spellCheck={false}
          className="w-full rounded border border-[var(--color-rule)] bg-transparent p-2 font-mono text-sm"
        />
      </Field>
    )
  }

  return (
    <Field hint={hint}>
      {/* Un seuil vide vaut « aucun seuil » : c'est le seul champ numérique
          qu'on a le droit de laisser vide, et il faut le dire. */}
      <FieldLabel optional={field.kind === 'nullablePercent'}>{label}</FieldLabel>
      <Input
        name={field.key}
        defaultValue={value}
        // `inputMode` plutôt que `type="number"` : le second laisse la molette
        // modifier la valeur au survol, ce qui est un bon moyen de changer une
        // marge sans s'en apercevoir en faisant défiler la page.
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  )
}

/**
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire : appelé
 * dans le parent, il renverrait toujours `false`. Ici, deux clics enverraient
 * deux écritures complètes de la configuration, et deux salves d'entrées
 * d'audit dont la seconde ne consignerait aucun changement.
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()

  return (
    <div>
      <Button type="submit" variant="primary" disabled={pending}>
        {label}
      </Button>
    </div>
  )
}
