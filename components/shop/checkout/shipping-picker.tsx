'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/cn'
import { formatPrice, formatGrams } from '@/lib/utils/format'
import { quoteShippingAction } from '@/lib/shop/shipping-actions'
import type { ShippingOptionsView } from '@/lib/shop/shipping-options'

/**
 * Choix du mode de livraison, sur devis réel.
 *
 * ---------------------------------------------------------------------------
 * Cinq états, et aucun n'est deviné
 * ---------------------------------------------------------------------------
 *  - `idle`     : pays ou code postal manquants. On ne demande rien.
 *  - `loading`  : devis en cours.
 *  - `ready`    : la liste des modes réellement disponibles, avec leur prix.
 *  - `error`    : le serveur a refusé, avec un motif traduit.
 *  - `stale`    : l'adresse a changé depuis le dernier devis. Le prix affiché
 *                 ne correspond plus à ce qui serait facturé — on le retire
 *                 plutôt que de le laisser vieillir sous les yeux.
 *
 * ---------------------------------------------------------------------------
 * Aucune estimation, jamais
 * ---------------------------------------------------------------------------
 * Pas de « à partir de », pas de tarif de repli, pas de moyenne. Un port qu'on
 * ne sait pas calculer se dit ; le facturer au hasard, ou l'annoncer plus bas
 * qu'il ne sera, est de l'information trompeuse.
 *
 * ---------------------------------------------------------------------------
 * Le formulaire ne transporte que des CODES
 * ---------------------------------------------------------------------------
 * `carrierCode`, `serviceCode`, et le point relais quand le service en exige
 * un. Jamais de montant : le serveur recalcule tout à partir des grilles en
 * base au moment d'ouvrir le paiement. Un champ caché portant le prix affiché
 * serait exactement le défaut que le cahier des charges interdit — et il
 * suffirait d'un outil de développement pour payer le port qu'on veut.
 *
 * ---------------------------------------------------------------------------
 * La garde de péremption est monotone
 * ---------------------------------------------------------------------------
 * Deux devis lancés à quelques frappes d'intervalle peuvent revenir dans le
 * désordre. Chaque demande porte un numéro croissant, et une réponse plus
 * ancienne que celle déjà affichée est jetée : sans cela, le prix de
 * l'avant-dernière adresse saisie peut s'installer durablement à l'écran.
 */

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; view: ShippingOptionsView }
  | { kind: 'error'; messageKey: string }

export interface ShippingSelection {
  carrierCode: string
  serviceCode: string
  servicePointId: string
  requiresServicePoint: boolean
  chargedCents: number
}

export function ShippingPicker({
  countryCode,
  postalCode,
  selection,
  onSelect,
  onQuote,
  disabled = false,
}: {
  countryCode: string
  postalCode: string
  selection: ShippingSelection | null
  onSelect: (selection: ShippingSelection | null) => void
  /** Remonte le devis courant, pour que le récapitulatif affiche le port. */
  onQuote: (view: ShippingOptionsView | null) => void
  disabled?: boolean
}) {
  const t = useTranslations('checkout.shipping')
  const locale = useLocale()
  const [state, setState] = useState<State>({ kind: 'idle' })

  // Numéro de la dernière demande LANCÉE et de la dernière AFFICHÉE. Les deux
  // sont des références : les modifier ne doit pas provoquer de rendu, et leur
  // valeur doit être lue à jour à l'intérieur d'une réponse tardive.
  const issued = useRef(0)
  const shown = useRef(0)

  const ready = state.kind === 'ready' ? state.view : null

  useEffect(() => {
    const country = countryCode.trim()
    const postal = postalCode.trim()

    // Le code postal est facultatif pour la résolution de zone — certains pays
    // n'en utilisent pas — mais tant que rien n'est saisi, demander un devis
    // ferait clignoter un refus « nous ne livrons pas là » à chaque frappe.
    if (country.length !== 2 || postal.length < 2) {
      issued.current += 1
      shown.current = issued.current
      setState({ kind: 'idle' })
      onSelect(null)
      onQuote(null)
      return
    }

    const ticket = (issued.current += 1)
    setState({ kind: 'loading' })
    // Le devis affiché ne vaut plus pour cette adresse : on le retire tout de
    // suite du récapitulatif plutôt que de laisser un total périmé.
    onQuote(null)

    // Le devis part après une pause : sans elle, taper « 59000 » lancerait
    // cinq requêtes, dont quatre pour des codes postaux incomplets.
    const timer = setTimeout(async () => {
      const result = await quoteShippingAction({
        countryCode: country,
        postalCode: postal,
        locale,
      })

      // Réponse dépassée par une plus récente : on la jette.
      if (ticket < shown.current) return
      shown.current = ticket

      if (result.status === 'error') {
        setState({ kind: 'error', messageKey: result.messageKey })
        onSelect(null)
        onQuote(null)
        return
      }

      setState({ kind: 'ready', view: result.view })
      onQuote(result.view)
    }, 400)

    return () => clearTimeout(timer)
    // `onSelect` et `onQuote` sont stables chez l'appelant (useCallback) : les
    // inscrire ici relancerait un devis à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryCode, postalCode, locale])

  if (state.kind === 'idle') {
    return (
      <Notice tone="neutral" className="bg-transparent p-0">
        <p className="text-xs">{t('needsAddress')}</p>
      </Notice>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <span className="sr-only" role="status">
          {t('quote')}
        </span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <Notice tone="warning" role="status">
        <p>{t(state.messageKey)}</p>
      </Notice>
    )
  }

  if (!ready) return null

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className="sr-only">{t('legend')}</legend>

      {/*
        Le poids du colis est un fait mesuré, et il explique le prix : sur une
        grille au palier, deux paniers voisins peuvent tomber de part et
        d'autre d'une limite.
      */}
      <p className="data text-xs text-muted">
        {t('parcel', {
          grams: formatGrams(ready.parcelWeightGrams, locale),
          zone: ready.zone.name,
        })}
      </p>

      {ready.options.map((option) => {
        const id = `${option.carrierCode}:${option.serviceCode}`
        const checked =
          selection?.carrierCode === option.carrierCode &&
          selection?.serviceCode === option.serviceCode

        return (
          <label
            key={id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-card border-[1.5px] p-4',
              'transition-colors duration-150 ease-out',
              checked
                ? 'border-rule bg-paper-raised'
                : 'border-sand-strong hover:bg-paper-raised',
            )}
          >
            <input
              type="radio"
              name="shippingOption"
              value={id}
              checked={checked}
              onChange={() =>
                onSelect({
                  carrierCode: option.carrierCode,
                  serviceCode: option.serviceCode,
                  servicePointId: '',
                  requiresServicePoint: option.requiresServicePoint,
                  chargedCents: option.chargedCents,
                })
              }
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--stamp)]"
            />

            <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="flex flex-col gap-0.5">
                <span className="text-base text-ink">{option.label}</span>
                <span className="data text-xs text-muted">
                  {t('days', {
                    min: option.deliveryDaysMin,
                    max: option.deliveryDaysMax,
                  })}
                </span>
              </span>

              <span className="flex flex-col items-end gap-0.5">
                <span data-numeric className="text-base text-ink">
                  {option.chargedCents === 0
                    ? t('free')
                    : formatPrice(option.chargedCents, locale)}
                </span>
                {/*
                  Le prix barré n'apparaît QUE si une franchise s'applique
                  réellement — c'est-à-dire quand le port aurait bien coûté ce
                  montant sans elle. Ce n'est pas un prix de référence inventé :
                  il vient de la grille.
                */}
                {option.freeShippingApplied &&
                option.fullChargedCents > option.chargedCents ? (
                  <span className="data text-xs text-muted line-through">
                    {formatPrice(option.fullChargedCents, locale)}
                  </span>
                ) : null}
              </span>
            </span>
          </label>
        )
      })}

      {/*
        Les deux champs que l'action lit réellement. Ils suivent la sélection
        plutôt que d'être portés par le bouton radio lui-même, dont la valeur
        est composite.
      */}
      <input
        type="hidden"
        name="carrierCode"
        value={selection?.carrierCode ?? ''}
      />
      <input
        type="hidden"
        name="serviceCode"
        value={selection?.serviceCode ?? ''}
      />

      {selection?.requiresServicePoint ? (
        <Field hint={t('servicePointHint')} className="mt-1">
          <FieldLabel>{t('servicePointLabel')}</FieldLabel>
          <Input
            name="servicePointId"
            value={selection.servicePointId}
            onChange={(event) =>
              onSelect({ ...selection, servicePointId: event.target.value })
            }
            required
            maxLength={64}
          />
        </Field>
      ) : null}
    </fieldset>
  )
}
