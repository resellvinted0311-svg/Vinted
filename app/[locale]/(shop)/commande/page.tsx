import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { readCart } from '@/lib/shop/cart'
import { tallyCart, canOpenCheckout, isPurchasable } from '@/lib/domain/cart'
import { getCurrentUser } from '@/lib/auth/session'
import { getSetting } from '@/lib/config/settings'
import { listServedCountryCodes } from '@/lib/db/queries/shipping'
import { isStripeConfigured } from '@/lib/payments/stripe'
import { localeTags, type Locale } from '@/lib/i18n/routing'
import { CheckoutForm } from '@/components/shop/checkout/checkout-form'

/** Dépend du panier et de la session : jamais mis en cache. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'checkout' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Le bon de commande.
 *
 * ---------------------------------------------------------------------------
 * Sans compte, et c'est voulu
 * ---------------------------------------------------------------------------
 * Le middleware ne protège PAS cette route. Obliger à créer un compte pour
 * acheter une pièce à quinze euros fait perdre plus de ventes que la fraude
 * n'en coûterait. Une commande passée sans compte reste retrouvable — et elle
 * rejoint le compte si l'on s'inscrit ensuite avec la même adresse depuis le
 * même navigateur.
 *
 * ---------------------------------------------------------------------------
 * Le panier sain est une condition d'ENTRÉE
 * ---------------------------------------------------------------------------
 * `prepareCheckoutFor` refuse le panier entier dès qu'une pièce n'est plus
 * payable. On renvoie donc au panier — où le retrait est possible, nommé pièce
 * par pièce — plutôt que de laisser remplir une adresse pour rien.
 *
 * Ce renvoi est NOMMÉ : il pose `?renvoi=…`, et le panier explique pourquoi.
 * Une redirection silencieuse est la même faute qu'un retrait silencieux.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('checkout')
  const cart = await readCart(locale)
  const tally = tallyCart(cart.lines)

  if (cart.lines.length === 0) {
    redirect(`/${locale}/panier?renvoi=panier-vide`)
  }
  if (!canOpenCheckout(tally)) {
    redirect(`/${locale}/panier?renvoi=lignes-bloquees`)
  }

  const [user, withdrawalPeriodDays, countryCodes] = await Promise.all([
    getCurrentUser(),
    getSetting('withdrawalPeriodDays'),
    listServedCountryCodes(),
  ])

  // Les noms de pays viennent d'`Intl`, pas d'une liste écrite à la main : ils
  // suivent la langue de la page, et personne n'a à les traduire huit fois.
  const displayNames = new Intl.DisplayNames(
    [localeTags[locale as Locale] ?? localeTags.fr],
    { type: 'region' },
  )

  const countries = countryCodes
    .map((code) => ({
      code,
      // `?? code` : un code que la table d'`Intl` ne connaît pas s'affiche tel
      // quel plutôt que de disparaître de la liste des pays desservis.
      label: displayNames.of(code) ?? code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale))

  const payable = cart.lines.filter((line) => isPurchasable(line.state))

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('title')}</h1>

      <div className="mt-8">
        <CheckoutForm
          lines={payable}
          subtotalCents={tally.subtotalCents}
          countries={countries}
          // Pré-rempli depuis le compte quand il y en a un, mais modifiable :
          // on peut vouloir la confirmation ailleurs que sur l'adresse du
          // compte.
          defaultEmail={user?.email ?? ''}
          publishableKey={
            process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null
          }
          withdrawalPeriodDays={withdrawalPeriodDays}
          paymentConfigured={isStripeConfigured()}
        />
      </div>
    </div>
  )
}
