'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel, useFieldControlProps } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import {
  createArticleAction,
  updateArticleAction,
  type ArticleActionState,
} from '@/lib/admin/article-actions'
import {
  ARTICLE_COLORS,
  ARTICLE_MATERIALS,
  ARTICLE_AUDIENCES,
  ARTICLE_FITS,
  ARTICLE_CONDITIONS,
  MEASUREMENT_KEYS,
} from '@/lib/domain/vocabulary'

/**
 * La fiche d'une pièce, à la saisie.
 *
 * ---------------------------------------------------------------------------
 * Ce composant ne décide de RIEN
 * ---------------------------------------------------------------------------
 * Il affiche des champs et les envoie. Aucun calcul de prix, aucune règle
 * d'état, aucune conversion de montant : le prix plancher est recalculé
 * serveur à chaque écriture, et un prix de vente en dessous est refusé là-bas.
 *
 * C'est la règle du projet — pas de logique métier dans un composant React — et
 * ici elle a une raison précise : un plancher calculé à l'écran serait un
 * plancher qu'on peut contourner en désactivant JavaScript.
 *
 * ---------------------------------------------------------------------------
 * Les montants se tapent en EUROS
 * ---------------------------------------------------------------------------
 * « 24,50 » part tel quel ; c'est le serveur qui en fait des centimes. Convertir
 * ici reviendrait à laisser la locale du navigateur décider si « 1.500 » vaut un
 * euro cinquante ou mille cinq cents euros.
 */

const INITIAL: ArticleActionState = { status: 'idle' }

export interface ArticleFormValues {
  categoryId: string
  brandName: string
  condition: string
  sizeLabel: string
  color: string
  material: string
  fit: string
  audience: string
  title: string
  description: string
  priceEuros: string
  costEuros: string
  weightGrams: string
  allowOffers: boolean
  autoDropEnabled: boolean
  sourcedFrom: string
  internalNotes: string
  measurements: Record<string, string>
}

export const EMPTY_ARTICLE: ArticleFormValues = {
  categoryId: '',
  brandName: '',
  condition: 'GOOD',
  sizeLabel: '',
  color: '',
  material: '',
  fit: '',
  audience: '',
  title: '',
  description: '',
  priceEuros: '',
  costEuros: '',
  weightGrams: '',
  // Ouverte par défaut à la saisie, mais VISIBLE : le défaut du schéma
  // s'appliquerait sans que personne l'ait choisi.
  allowOffers: true,
  autoDropEnabled: false,
  sourcedFrom: '',
  internalNotes: '',
  measurements: {},
}

export function ArticleForm({
  mode,
  articleId,
  expectedUpdatedAt,
  values,
  categories,
  floorPriceLabel,
  locale,
}: {
  mode: 'create' | 'edit'
  articleId?: string
  /** Horodatage lu au rendu : voir `lib/validation/article.ts`. */
  expectedUpdatedAt?: string
  values: ArticleFormValues
  categories: readonly { id: string; name: string }[]
  /** Le plancher courant, déjà formaté. Indicatif — le serveur recalcule. */
  floorPriceLabel?: string
  /** Sert à la redirection après création. */
  locale: string
}) {
  const t = useTranslations('admin.articles')
  // Le vocabulaire est celui de la fiche PUBLIQUE, pas une copie : les mêmes
  // mots des deux côtés, et une seule liste à traduire le jour où elle bouge.
  const tCondition = useTranslations('condition')
  const tCatalogue = useTranslations('catalogue')
  const tMeasure = useTranslations('measurement')
  const [state, formAction] = useActionState(
    mode === 'create' ? createArticleAction : updateArticleAction,
    INITIAL,
  )

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="locale" value={locale} />
      {articleId ? (
        <input type="hidden" name="articleId" value={articleId} />
      ) : null}
      {expectedUpdatedAt ? (
        <input
          type="hidden"
          name="expectedUpdatedAt"
          value={expectedUpdatedAt}
        />
      ) : null}

      {state.status === 'saved' ? (
        <Notice tone="success" role="status">
          <p>{t('saved')}</p>
        </Notice>
      ) : null}

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`errors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm uppercase tracking-wide">
          {t('sections.identity')}
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field hint={t('fields.categoryId.hint')}>
            <FieldLabel>{t('fields.categoryId.label')}</FieldLabel>
            <NativeSelect
              name="categoryId"
              value={values.categoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              placeholder={t('fields.categoryId.placeholder')}
            />
          </Field>

          <Field hint={t('fields.brandName.hint')}>
            <FieldLabel optional>{t('fields.brandName.label')}</FieldLabel>
            <Input name="brandName" defaultValue={values.brandName} autoComplete="off" />
          </Field>

          <Field hint={t('fields.title.hint')}>
            <FieldLabel>{t('fields.title.label')}</FieldLabel>
            <Input name="title" defaultValue={values.title} autoComplete="off" />
          </Field>

          <Field hint={t('fields.sizeLabel.hint')}>
            <FieldLabel>{t('fields.sizeLabel.label')}</FieldLabel>
            <Input
              name="sizeLabel"
              defaultValue={values.sizeLabel}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </Field>

          <Field hint={t('fields.condition.hint')}>
            <FieldLabel>{t('fields.condition.label')}</FieldLabel>
            <NativeSelect
              name="condition"
              value={values.condition}
              options={ARTICLE_CONDITIONS.map((c) => ({
                value: c,
                label: tCondition(`${c}.label`),
              }))}
            />
          </Field>

          <Field hint={t('fields.color.hint')}>
            <FieldLabel optional>{t('fields.color.label')}</FieldLabel>
            <NativeSelect
              name="color"
              value={values.color}
              allowEmpty
              placeholder={t('none')}
              options={ARTICLE_COLORS.map((c) => ({
                value: c,
                label: tCatalogue(`colors.${c}`),
              }))}
            />
          </Field>

          <Field hint={t('fields.material.hint')}>
            <FieldLabel optional>{t('fields.material.label')}</FieldLabel>
            <NativeSelect
              name="material"
              value={values.material}
              allowEmpty
              placeholder={t('none')}
              options={ARTICLE_MATERIALS.map((m) => ({
                value: m,
                label: tCatalogue(`materials.${m}`),
              }))}
            />
          </Field>

          <Field hint={t('fields.fit.hint')}>
            <FieldLabel optional>{t('fields.fit.label')}</FieldLabel>
            <NativeSelect
              name="fit"
              value={values.fit}
              allowEmpty
              placeholder={t('none')}
              options={ARTICLE_FITS.map((f) => ({
                value: f,
                label: tCatalogue(`fits.${f}`),
              }))}
            />
          </Field>

          {/*
            L'univers, saisi ici et nulle part ailleurs.

            Facultatif comme ses voisins, et pour une raison de plus : les
            pièces déjà en ligne n'en ont pas, et l'application de gestion ne
            l'envoie pas. Une pièce non qualifiée reste au catalogue ; elle
            n'apparaît simplement dans aucun des deux univers.
          */}
          <Field hint={t('fields.audience.hint')}>
            <FieldLabel optional>{t('fields.audience.label')}</FieldLabel>
            <NativeSelect
              name="audience"
              value={values.audience}
              allowEmpty
              placeholder={t('none')}
              options={ARTICLE_AUDIENCES.map((a) => ({
                value: a,
                label: tCatalogue(`audiences.${a}`),
              }))}
            />
          </Field>
        </div>

        <Field hint={t('fields.description.hint')} className="sm:col-span-2">
          <FieldLabel optional>{t('fields.description.label')}</FieldLabel>
          <TextArea name="description" value={values.description} rows={5} />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm uppercase tracking-wide">
          {t('sections.economy')}
        </legend>

        {floorPriceLabel ? (
          <Notice tone="info" role="status">
            <p>{t('floorPrice', { amount: floorPriceLabel })}</p>
          </Notice>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field hint={t('fields.costEuros.hint')}>
            <FieldLabel>{t('fields.costEuros.label')}</FieldLabel>
            <Input
              name="costEuros"
              defaultValue={values.costEuros}
              inputMode="decimal"
              autoComplete="off"
            />
          </Field>

          <Field hint={t('fields.priceEuros.hint')}>
            <FieldLabel>{t('fields.priceEuros.label')}</FieldLabel>
            <Input
              name="priceEuros"
              defaultValue={values.priceEuros}
              inputMode="decimal"
              autoComplete="off"
            />
          </Field>

          <Field hint={t('fields.weightGrams.hint')}>
            <FieldLabel>{t('fields.weightGrams.label')}</FieldLabel>
            <Input
              name="weightGrams"
              defaultValue={values.weightGrams}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          <Field hint={t('fields.allowOffers.hint')}>
            <FieldLabel>{t('fields.allowOffers.label')}</FieldLabel>
            <FormCheckbox name="allowOffers" checked={values.allowOffers} />
          </Field>

          <Field hint={t('fields.autoDropEnabled.hint')}>
            <FieldLabel>{t('fields.autoDropEnabled.label')}</FieldLabel>
            <FormCheckbox
              name="autoDropEnabled"
              checked={values.autoDropEnabled}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm uppercase tracking-wide">
          {t('sections.measurements')}
        </legend>
        <p className="text-xs text-muted">{t('measurementsHint')}</p>

        <div className="grid gap-4 sm:grid-cols-4">
          {MEASUREMENT_KEYS.map((key) => (
            <Field key={key}>
              <FieldLabel optional>{tMeasure(`keys.${key}`)}</FieldLabel>
              <Input
                name={`measure.${key}`}
                defaultValue={values.measurements[key] ?? ''}
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm uppercase tracking-wide">
          {t('sections.private')}
        </legend>
        {/* Ces deux champs ne sortent dans AUCUNE réponse publique : le schéma
            les marque privés, et les sélecteurs publics ne les nomment pas. */}
        <p className="text-xs text-muted">{t('privateHint')}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field hint={t('fields.sourcedFrom.hint')}>
            <FieldLabel optional>{t('fields.sourcedFrom.label')}</FieldLabel>
            <Input
              name="sourcedFrom"
              defaultValue={values.sourcedFrom}
              autoComplete="off"
            />
          </Field>

          <Field hint={t('fields.internalNotes.hint')}>
            <FieldLabel optional>{t('fields.internalNotes.label')}</FieldLabel>
            <TextArea name="internalNotes" value={values.internalNotes} rows={3} />
          </Field>
        </div>
      </fieldset>

      <SubmitButton label={mode === 'create' ? t('create') : t('save')} />
    </form>
  )
}

/**
 * Une liste déroulante NATIVE, et c'est un choix.
 *
 * La primitive `Select` du projet est bâtie sur Radix : elle apporte la
 * navigation clavier et les annonces ARIA d'un menu personnalisé, ce qui vaut
 * son coût sur les écrans publics.
 *
 * Ici, la valeur doit surtout arriver intacte dans `FormData` sur un formulaire
 * NON contrôlé, et rester saisissable si le script ne s'est pas chargé. Une
 * balise native fait les deux sans état React, et le clavier d'un téléphone
 * ouvre son sélecteur habituel.
 */
function NativeSelect({
  name,
  value,
  options,
  placeholder,
  allowEmpty = false,
}: {
  name: string
  value: string
  options: readonly { value: string; label: string }[]
  placeholder?: string
  allowEmpty?: boolean
}) {
  const control = useFieldControlProps()

  return (
    <select
      {...control}
      name={name}
      defaultValue={value}
      className="w-full rounded border border-[var(--color-rule)] bg-transparent px-2 py-2 text-sm text-ink"
    >
      {allowEmpty || value === '' ? (
        <option value="">{placeholder ?? ''}</option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function TextArea({
  name,
  value,
  rows,
}: {
  name: string
  value: string
  rows: number
}) {
  const control = useFieldControlProps()

  return (
    <textarea
      {...control}
      name={name}
      defaultValue={value}
      rows={rows}
      className="w-full rounded border border-[var(--color-rule)] bg-transparent p-2 text-sm text-ink"
    />
  )
}

function FormCheckbox({ name, checked }: { name: string; checked: boolean }) {
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
 * dans le parent, il renverrait toujours `false`. Ici, deux clics créeraient
 * deux pièces — et consommeraient deux numéros d'inventaire.
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
