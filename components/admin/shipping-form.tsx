'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { BareInput } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import {
  updateShippingRatesAction,
  type AdminShippingState,
} from '@/lib/admin/shipping-actions'
import type { ZoneEditable } from '@/lib/admin/shipping-rates'

/**
 * Les tarifs de port, à l'écran.
 *
 * ---------------------------------------------------------------------------
 * Les lignes viennent du SERVEUR, et l'action les relit en base
 * ---------------------------------------------------------------------------
 * Cet écran n'écrit aucune liste de zones ni de paliers : il affiche ce que la
 * page a lu. Et l'action serveur, de son côté, repart elle aussi des lignes
 * réellement en base — elle ne parcourt pas le formulaire. Les deux ne peuvent
 * donc pas diverger, et un champ fabriqué à la main n'est jamais regardé.
 *
 * ---------------------------------------------------------------------------
 * Ce qui s'affiche sans être modifiable, et pourquoi on l'affiche quand même
 * ---------------------------------------------------------------------------
 * Le palier de poids, le transporteur et les délais sont montrés en lecture
 * seule. Ils ne se corrigent pas ici — ce sont des données de structure — mais
 * les cacher rendrait les prix illisibles : « 4,20 » ne veut rien dire sans
 * « jusqu'à 500 g, en point relais ».
 *
 * ---------------------------------------------------------------------------
 * Les montants sont des COÛTS transporteur
 * ---------------------------------------------------------------------------
 * Pas ce que l'acheteuse paie. La majoration s'applique par-dessus, et se règle
 * sur l'écran des réglages. L'en-tête de l'écran le dit, parce que confondre
 * les deux ferait facturer deux fois la marge.
 */

const INITIAL: AdminShippingState = { status: 'idle' }

/**
 * Un palier de poids, tel qu'une grille transporteur l'écrit.
 *
 * « 5 kg » et non « 5000 g » : on recopie cet écran depuis une grille
 * tarifaire, et chaque conversion mentale est une occasion de se tromper de
 * ligne. Les symboles « g » et « kg » sont composés ici plutôt que traduits :
 * ce sont des symboles SI, identiques dans les huit langues.
 */
function poids(grammes: number): string {
  if (grammes >= 1000 && grammes % 1000 === 0) return `${grammes / 1000} kg`
  return `${grammes} g`
}

/** Centimes vers une saisie en euros. « 420 » devient « 4,20 ». */
function enEuros(cents: number | null): string {
  if (cents === null) return ''
  // La virgule, parce que c'est le séparateur décimal de sept des huit langues
  // du site — et `parseAmountToCents` accepte les deux au retour.
  return (cents / 100).toFixed(2).replace('.', ',')
}

export function ShippingForm({ zones }: { zones: readonly ZoneEditable[] }) {
  const t = useTranslations('admin.shipping')

  const [state, formAction] = useActionState(updateShippingRatesAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <Notice tone="info" role="status">
        <p>{t('costNotMargin')}</p>
      </Notice>

      {state.status === 'done' ? (
        <Notice tone="success" role="status">
          <p>{t('saved', { count: state.changed })}</p>
        </Notice>
      ) : null}

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`errors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      {zones.map((zone) => (
        <fieldset key={zone.id} className="flex flex-col gap-4">
          <legend className="text-sm uppercase tracking-wide">
            {zone.name}
            {/*
              Le code de zone à côté du nom : c'est lui qu'on retrouve dans le
              réglage « zone de plancher » et dans les journaux, et il n'est
              traduit nulle part.
            */}
            <span data-numeric className="ml-2 text-muted">
              {zone.code}
            </span>
          </legend>

          <div className="max-w-xs">
            <Field hint={t('freeShippingHint')}>
              <FieldLabel>{t('freeShipping')}</FieldLabel>
              <BareInput
                name={`seuil:${zone.id}`}
                defaultValue={enEuros(zone.freeShippingThresholdCents)}
                inputMode="decimal"
                // Pas de `type="number"` : il refuse la virgule dans plusieurs
                // navigateurs selon la langue du système, et c'est exactement
                // ce qu'on vient d'accepter côté serveur.
                placeholder={t('freeShippingNever')}
              />
            </Field>
          </div>

          {zone.tarifs.length === 0 ? (
            <p className="text-sm text-muted">{t('noRates')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b-[1.5px] border-rule text-left">
                    <th scope="col" className="py-2 pr-4 font-normal">
                      {t('columns.service')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      {t('columns.weight')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      {t('columns.cost')}
                    </th>
                    <th scope="col" className="py-2 font-normal">
                      {t('columns.active')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {zone.tarifs.map((tarif) => (
                    <tr
                      key={tarif.id}
                      className="border-b border-sand last:border-0"
                    >
                      <td className="py-2 pr-4">
                        {tarif.label}
                        <span className="ml-2 text-xs text-muted">
                          {t('deliveryDays', {
                            min: tarif.deliveryDaysMin,
                            max: tarif.deliveryDaysMax,
                          })}
                        </span>
                      </td>
                      <td data-numeric className="py-2 pr-4 whitespace-nowrap">
                        {t('upTo', { weight: poids(tarif.maxWeightGrams) })}
                      </td>
                      <td className="py-2 pr-4">
                        <BareInput
                          name={`prix:${tarif.id}`}
                          defaultValue={enEuros(tarif.priceCents)}
                          inputMode="decimal"
                          className="w-28"
                          aria-label={t('costFor', {
                            service: tarif.label,
                            weight: poids(tarif.maxWeightGrams),
                          })}
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          name={`actif:${tarif.id}`}
                          defaultChecked={tarif.active}
                          className="size-5 accent-[var(--color-ink)]"
                          aria-label={t('activeFor', {
                            service: tarif.label,
                            weight: poids(tarif.maxWeightGrams),
                          })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </fieldset>
      ))}

      <SubmitButton label={t('save')} />
    </form>
  )
}

/**
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire : appelé
 * dans le parent, il renverrait toujours `false`. Ici, deux clics enverraient
 * deux écritures complètes de la grille, et la seconde consignerait une salve
 * d'entrées d'audit sans aucun changement.
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
