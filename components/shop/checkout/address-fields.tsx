'use client'

import { useTranslations } from 'next-intl'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/select'

/**
 * Les champs d'adresse du bon de commande.
 *
 * ---------------------------------------------------------------------------
 * Contrôlés, et ce n'est pas un choix de style
 * ---------------------------------------------------------------------------
 * React 19 réinitialise les entrées NON contrôlées d'un `<form action={…}>`
 * quand l'action se termine. Or aucune des onze erreurs du serveur ne renvoie
 * les valeurs saisies : sur un refus — une pièce vendue entre-temps, un mode
 * de livraison disparu — la personne retrouverait un formulaire vide après
 * avoir tout tapé. Sur mobile, c'est un abandon garanti.
 *
 * L'état vit donc chez le parent, qui le garde d'un envoi à l'autre.
 *
 * ---------------------------------------------------------------------------
 * Les noms sont ceux que l'action lit
 * ---------------------------------------------------------------------------
 * `checkout-actions.ts` lit `formData.get('firstName')`, `('line1')`, etc. Un
 * nom qui diverge ne produit aucune erreur de compilation : il produit une
 * adresse vide validée en « adresse invalide ».
 *
 * ---------------------------------------------------------------------------
 * Le pays est un `<select>` natif
 * ---------------------------------------------------------------------------
 * Pas le composant `Select` du design system : Radix le rend dans un portail,
 * ce qui casse le remplissage automatique d'adresse du navigateur et prive
 * mobile de la roulette native. Sur un formulaire d'achat, la commodité de
 * saisie l'emporte sur l'uniformité visuelle.
 *
 * La liste vient des ZONES en base : proposer un pays qu'aucune zone ne couvre
 * mènerait quelqu'un à remplir toute son adresse pour s'entendre dire, à la
 * fin, qu'on ne livre pas chez lui.
 */

export interface AddressValues {
  firstName: string
  lastName: string
  line1: string
  line2: string
  postalCode: string
  city: string
  country: string
  phone: string
}

export const EMPTY_ADDRESS: AddressValues = {
  firstName: '',
  lastName: '',
  line1: '',
  line2: '',
  postalCode: '',
  city: '',
  country: '',
  phone: '',
}

export function AddressFields({
  values,
  onChange,
  countries,
  disabled = false,
}: {
  values: AddressValues
  onChange: (patch: Partial<AddressValues>) => void
  /** Codes ISO desservis, avec leur nom dans la langue courante. */
  countries: readonly { code: string; label: string }[]
  disabled?: boolean
}) {
  const t = useTranslations('checkout.field')
  const tCommon = useTranslations('common')

  const set =
    (key: keyof AddressValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: event.target.value })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel>{t('firstName')}</FieldLabel>
        <Input
          name="firstName"
          value={values.firstName}
          onChange={set('firstName')}
          autoComplete="given-name"
          required
          maxLength={80}
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel>{t('lastName')}</FieldLabel>
        <Input
          name="lastName"
          value={values.lastName}
          onChange={set('lastName')}
          autoComplete="family-name"
          required
          maxLength={80}
          disabled={disabled}
        />
      </Field>

      <Field className="sm:col-span-2">
        <FieldLabel>{t('line1')}</FieldLabel>
        <Input
          name="line1"
          value={values.line1}
          onChange={set('line1')}
          autoComplete="address-line1"
          required
          maxLength={120}
          disabled={disabled}
        />
      </Field>

      <Field className="sm:col-span-2">
        <FieldLabel optional>{t('line2')}</FieldLabel>
        <Input
          name="line2"
          value={values.line2}
          onChange={set('line2')}
          autoComplete="address-line2"
          maxLength={120}
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel>{t('postalCode')}</FieldLabel>
        <Input
          name="postalCode"
          value={values.postalCode}
          onChange={set('postalCode')}
          autoComplete="postal-code"
          // `inputMode` et non `type="number"` : les codes postaux de plusieurs
          // pays contiennent des lettres et des espaces, et `number` en
          // interdirait la saisie tout en autorisant les flèches haut/bas.
          inputMode="text"
          required
          maxLength={12}
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel>{t('city')}</FieldLabel>
        <Input
          name="city"
          value={values.city}
          onChange={set('city')}
          autoComplete="address-level2"
          required
          maxLength={80}
          disabled={disabled}
        />
      </Field>

      <Field className="sm:col-span-2">
        <FieldLabel>{t('country')}</FieldLabel>
        <NativeSelect
          name="country"
          value={values.country}
          onChange={set('country')}
          autoComplete="country"
          required
          disabled={disabled}
        >
          <option value="">{tCommon('selectPlaceholder')}</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field className="sm:col-span-2" hint={t('phoneHint')}>
        <FieldLabel optional>{t('phone')}</FieldLabel>
        <Input
          name="phone"
          value={values.phone}
          onChange={set('phone')}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          maxLength={30}
          disabled={disabled}
        />
      </Field>
    </div>
  )
}
