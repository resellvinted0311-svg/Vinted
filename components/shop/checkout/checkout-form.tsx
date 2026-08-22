'use client'

import { useActionState, useCallback, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { formatPrice } from '@/lib/utils/format'
import {
  startCheckoutAction,
  type CheckoutActionState,
} from '@/lib/shop/checkout-actions'
import type { CartLineView } from '@/lib/shop/cart'
import type { ShippingOptionsView } from '@/lib/shop/shipping-options'
import { CartLineRow } from '@/components/shop/cart-line-row'
import { TotalsSheet } from '@/components/shop/totals-sheet'
import { Volet } from './volet'
import {
  AddressFields,
  EMPTY_ADDRESS,
  type AddressValues,
} from './address-fields'
import { ShippingPicker, type ShippingSelection } from './shipping-picker'
import { CheckoutErrorNotice } from './checkout-error-notice'
import { EmbeddedPayment } from './embedded-payment'

/**
 * Le bon de commande.
 *
 * ---------------------------------------------------------------------------
 * Quatre volets, un seul écran, un seul formulaire
 * ---------------------------------------------------------------------------
 * Tout est visible en même temps et modifiable dans n'importe quel ordre. Les
 * ordinaux servent à se repérer, pas à mesurer une progression.
 *
 * Un seul `<form>` : les formulaires imbriqués ne sont pas du HTML valide, et
 * le navigateur en fait ce qu'il veut.
 *
 * ---------------------------------------------------------------------------
 * Ce composant ne décide de rien
 * ---------------------------------------------------------------------------
 * Il ne calcule aucun total à facturer, ne vérifie aucune disponibilité, ne
 * juge aucune adresse. Le seul montant qui fasse foi est celui que l'action
 * renvoie à l'état `ready` — recalculé serveur, à partir de la base. Ce que le
 * récapitulatif affiche avant cela vient du devis, et le devis le dit.
 *
 * ---------------------------------------------------------------------------
 * Le bouton n'est jamais éteint pour cause de formulaire incomplet
 * ---------------------------------------------------------------------------
 * Le serveur a onze messages pour expliquer un refus ; un bouton mort n'en a
 * aucun. Il n'est désactivé que pendant l'envoi.
 */

const INITIAL: CheckoutActionState = { status: 'idle' }

export function CheckoutForm({
  lines,
  subtotalCents,
  countries,
  defaultEmail,
  publishableKey,
  withdrawalPeriodDays,
  paymentConfigured,
}: {
  lines: readonly CartLineView[]
  subtotalCents: number
  countries: readonly { code: string; label: string }[]
  defaultEmail: string
  publishableKey: string | null
  withdrawalPeriodDays: number
  paymentConfigured: boolean
}) {
  const t = useTranslations('checkout')
  const locale = useLocale()

  const [state, formAction, isPending] = useActionState(
    startCheckoutAction,
    INITIAL,
  )

  // Champs CONTRÔLÉS : React 19 réinitialise les entrées non contrôlées d'un
  // `<form action>` à la fin de l'action, et aucune des onze erreurs ne renvoie
  // les valeurs saisies. Sans cet état, un refus viderait tout le formulaire.
  const [email, setEmail] = useState(defaultEmail)
  const [note, setNote] = useState('')
  const [terms, setTerms] = useState(false)
  const [address, setAddress] = useState<AddressValues>(EMPTY_ADDRESS)
  const [selection, setSelection] = useState<ShippingSelection | null>(null)
  const [quote, setQuote] = useState<ShippingOptionsView | null>(null)

  const patchAddress = useCallback((patch: Partial<AddressValues>) => {
    setAddress((current) => ({ ...current, ...patch }))
  }, [])

  // Stables : le sélecteur de livraison les inscrit dans ses dépendances, et
  // des fonctions recréées à chaque rendu y relanceraient un devis en boucle.
  const handleSelect = useCallback(
    (next: ShippingSelection | null) => setSelection(next),
    [],
  )
  const handleQuote = useCallback(
    (next: ShippingOptionsView | null) => setQuote(next),
    [],
  )

  // Le paiement est ouvert : le bordereau se scelle. Modifier l'adresse
  // maintenant ne changerait plus rien à ce qui sera débité — la commande
  // existe en base et le stock est verrouillé.
  if (state.status === 'ready') {
    return (
      <div className="flex flex-col gap-6">
        <Notice tone="success" role="status" title={t('orderRegistered', {
          orderNumber: state.orderNumber,
        })}>
          <p className="flex items-baseline justify-between gap-4">
            <span>{t('totalDue')}</span>
            <span data-numeric className="text-lg text-ink">
              {formatPrice(state.totalCents, locale)}
            </span>
          </p>
        </Notice>

        <EmbeddedPayment
          clientSecret={state.clientSecret}
          publishableKey={publishableKey}
        />

        <p className="text-xs text-muted">{t('editWarning')}</p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* La langue de la commande : elle décide de la langue de l'e-mail de
          confirmation, longtemps après que l'onglet est fermé. */}
      <input type="hidden" name="locale" value={locale} />

      {state.status === 'error' ? (
        <CheckoutErrorNotice
          messageKey={state.messageKey}
          articleIds={state.articleIds}
          lines={lines}
        />
      ) : null}

      <Volet ordinal="01" title={t('recap')} hint={t('recapHint')}>
        <ul className="divide-y divide-sand">
          {lines.map((line, index) => (
            <CartLineRow key={line.cartItemId} line={line} index={index + 1} />
          ))}
        </ul>

        <div className="mt-4 border-t-[1.5px] border-rule pt-4">
          <TotalsSheet
            subtotalCents={subtotalCents}
            shippingCents={selection?.chargedCents ?? null}
          />
        </div>

        <Link
          href="/panier"
          className="label-reg mt-4 inline-block text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {t('editOrder')}
        </Link>
      </Volet>

      <Volet ordinal="02" title={t('contact')} hint={t('emailHint')}>
        <Field>
          <FieldLabel>{t('field.email')}</FieldLabel>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            disabled={isPending}
          />
        </Field>
      </Volet>

      <Volet ordinal="03" title={t('address')}>
        <AddressFields
          values={address}
          onChange={patchAddress}
          countries={countries}
          disabled={isPending}
        />

        <div className="mt-6 border-t border-sand pt-6">
          <h3 className="label-reg text-ink">{t('shipping.legend')}</h3>
          <div className="mt-3">
            <ShippingPicker
              countryCode={address.country}
              postalCode={address.postalCode}
              selection={selection}
              onSelect={handleSelect}
              onQuote={handleQuote}
              disabled={isPending}
            />
          </div>
        </div>

        <Field className="mt-6" hint={t('noteHint')}>
          <FieldLabel optional>{t('note')}</FieldLabel>
          <Textarea
            name="customerNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={3}
            disabled={isPending}
          />
        </Field>
      </Volet>

      <Volet ordinal="04" title={t('payment')} hint={t('cardOnly')}>
        <div className="flex flex-col gap-4">
          <Checkbox
            name="acceptsTerms"
            checked={terms}
            onChange={(event) => setTerms(event.target.checked)}
            disabled={isPending}
            label={
              <>
                {t('terms.label')}{' '}
                <Link
                  href="/pages/cgv"
                  target="_blank"
                  className="underline underline-offset-4"
                >
                  {t('terms.link')}
                </Link>
              </>
            }
          />

          {/* Mention légale d'information précontractuelle : le délai vient
              d'un réglage en base, jamais d'un nombre écrit dans le code. */}
          <p className="text-xs text-muted">
            {t('legal.withdrawal', { days: withdrawalPeriodDays })}
          </p>

          <p className="text-xs text-muted">
            {t('privacy.notice')}{' '}
            <Link
              href="/pages/confidentialite"
              className="underline underline-offset-4"
            >
              {t('privacy.link')}
            </Link>
          </p>

          {paymentConfigured ? null : (
            <Notice tone="warning" role="status">
              <p>{t('errors.paymentNotConfigured')}</p>
            </Notice>
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={isPending || !paymentConfigured}
          >
            {/*
              Le montant du bouton vient du devis, pas d'une addition écrite
              ici. Tant que le port est inconnu, le bouton ne promet aucun
              montant — il ne dit pas « 0,00 € », il ne dit rien.
            */}
            {quote && selection
              ? t('placeOrder', {
                  total: formatPrice(
                    subtotalCents + selection.chargedCents,
                    locale,
                  ),
                })
              : t('placeOrderNoTotal')}
          </Button>

          <p className="text-xs text-muted">{t('paymentOpensBelow')}</p>
        </div>
      </Volet>
    </form>
  )
}
