'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel, useFieldControlProps } from '@/components/ui/field'
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

/** Une zone d'expédition telle qu'elle existe en base. */
export interface ZoneOption {
  code: string
  name: string
}

export function SettingsForm({
  fields,
  values,
  profile,
  zones,
  missing,
}: {
  fields: readonly EditableSetting[]
  values: SettingsFormValues
  /** `development` tant que personne n'a enregistré de vraies valeurs. */
  profile: 'development' | 'production'
  /** Les zones réellement en base, pour la liste du réglage de plancher. */
  zones: readonly ZoneOption[]
  /** Les réglages dont la LIGNE est absente. Voir la bannière ci-dessous. */
  missing: readonly string[]
}) {
  const t = useTranslations('admin.settings')
  const [state, formAction] = useActionState(updateSettingsAction, INITIAL)

  const groups = [...new Set(fields.map((field) => field.group))]

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {/**
       * Les lignes absentes, nommées.
       *
       * Un champ vide et un champ dont la ligne n'existe pas se ressemblent à
       * l'écran, et n'ont rien à voir : le second fait refuser l'enregistrement
       * ENTIER, y compris les valeurs qu'on vient de saisir. On enregistrait,
       * rien ne se passait, et le message ne désignait qu'un champ qu'on
       * croyait rempli.
       *
       * Ceux qui figurent dans le formulaire se réparent en enregistrant. Les
       * autres — ils sont rares et volontairement non éditables — sont nommés
       * quand même : sans cela, la boutique refuserait de calculer un prix pour
       * une raison qu'aucun écran n'affiche.
       */}
      {missing.length > 0 ? (
        <Notice tone="warning" role="status">
          <p>{t('missingRows')}</p>
          <ul className="mt-2 list-disc pl-5 font-mono text-sm">
            {missing.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

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
                  zones={zones}
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
  zones,
}: {
  field: EditableSetting
  value: string
  zones: readonly ZoneOption[]
}) {
  const t = useTranslations('admin.settings')
  const label = t(`fields.${field.key}.label`)
  const hint = t(`fields.${field.key}.hint`)

  if (field.kind === 'zoneCode') {
    return (
      <Field hint={hint}>
        <FieldLabel>{label}</FieldLabel>
        <ZoneSelect name={field.key} value={value} zones={zones} />
      </Field>
    )
  }

  if (field.kind === 'boolean') {
    return (
      <Field hint={hint}>
        <FieldLabel>{label}</FieldLabel>
        <Checkbox name={field.key} checked={value === 'true'} />
      </Field>
    )
  }

  if (field.kind === 'dropSchedule') {
    return (
      <Field hint={hint} className="sm:col-span-2">
        <FieldLabel>{label}</FieldLabel>
        <ScheduleTextarea name={field.key} value={value} />
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
 * Les deux contrôles que `Input` ne couvre pas.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ils sont des composants et non des balises écrites sur place
 * ---------------------------------------------------------------------------
 * `useFieldControlProps()` pose l'`id` que le `<label>` vise, plus les liens
 * ARIA vers l'aide et l'erreur. Le hook ne peut être appelé que DANS un
 * `<Field>`, donc depuis un composant enfant.
 *
 * Écrits en balises brutes — ce qu'ils étaient d'abord — ni la case à cocher ni
 * la zone de texte ne portaient d'`id` : leur étiquette ne visait rien. À
 * l'écran on ne voit aucune différence ; au lecteur d'écran, le champ est
 * annoncé sans nom, et cliquer sur le libellé ne donne pas le focus. C'est un
 * test Playwright qui cherchait le champ PAR SON ÉTIQUETTE qui l'a révélé.
 */
function ScheduleTextarea({ name, value }: { name: string; value: string }) {
  const control = useFieldControlProps()

  return (
    <textarea
      {...control}
      name={name}
      defaultValue={value}
      rows={4}
      spellCheck={false}
      className="w-full rounded border border-[var(--color-rule)] bg-transparent p-2 font-mono text-sm"
    />
  )
}

/**
 * La zone qui sert de référence au calcul du prix plancher.
 *
 * ---------------------------------------------------------------------------
 * Une liste, et pas un champ de saisie
 * ---------------------------------------------------------------------------
 * Ce réglage était volontairement absent du formulaire, pour une raison juste :
 * un champ libre y aurait écrit une zone inexistante, et le calcul du plancher
 * serait tombé sur toutes les pièces à la fois — loin d'ici, et sans rien qui
 * désigne cette saisie.
 *
 * Les options viennent de la base, donc on ne peut choisir qu'une zone qui
 * existe. Ce n'est PAS la validation pour autant : l'action revérifie le code
 * reçu contre la base, parce qu'une Server Action est un POST et qu'une liste
 * côté navigateur ne contraint personne.
 *
 * L'option vide n'est là que si rien n'est encore choisi : elle évite qu'un
 * navigateur sélectionne d'office la première zone et fasse croire à un choix
 * que personne n'a fait.
 */
function ZoneSelect({
  name,
  value,
  zones,
}: {
  name: string
  value: string
  zones: readonly ZoneOption[]
}) {
  const t = useTranslations('admin.settings')
  const control = useFieldControlProps()

  /**
   * Une valeur stockée qui n'a pas d'option est REMPLACÉE EN SILENCE.
   *
   * C'est le comportement du navigateur, pas un choix : `defaultValue` sur un
   * code qu'aucune option ne porte laisse la liste se rabattre sur sa première
   * entrée. L'écran affichait donc une zone que personne n'avait choisie, et
   * l'enregistrement suivant l'aurait écrite pour de bon — une valeur de prix
   * changée par un affichage.
   *
   * Le cas n'est pas théorique : il survient dès qu'un code est écrit à la main
   * en base, ou qu'une zone est renommée ou supprimée après coup. On rend donc
   * une option pour la valeur stockée, marquée comme inconnue, pour qu'elle
   * reste VISIBLE et corrigible.
   */
  const connue = zones.some((zone) => zone.code === value)

  return (
    <select
      {...control}
      name={name}
      defaultValue={value}
      className="w-full rounded border border-[var(--color-rule)] bg-transparent p-2 text-sm"
    >
      {value === '' ? <option value="" /> : null}
      {value !== '' && !connue ? (
        <option value={value}>{t('unknownZoneOption', { code: value })}</option>
      ) : null}
      {zones.map((zone) => (
        <option key={zone.code} value={zone.code}>
          {zone.name}
        </option>
      ))}
    </select>
  )
}

function Checkbox({ name, checked }: { name: string; checked: boolean }) {
  const control = useFieldControlProps()

  return (
    <input
      {...control}
      type="checkbox"
      name={name}
      defaultChecked={checked}
      className="size-5 accent-[var(--color-ink)]"
    />
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
