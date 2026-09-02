import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth/session'
import { listOffers } from '@/lib/db/queries/offers'
import { offerNeedsAttention } from '@/lib/domain/offers'
import { OfferRegisterRow } from '@/components/shop/offer/offer-register-row'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'offers' })
  return { title: t('registerTitle'), robots: { index: false, follow: false } }
}

/**
 * Le registre des négociations, côté compte.
 *
 * ---------------------------------------------------------------------------
 * Le contrôle est REFAIT ici
 * ---------------------------------------------------------------------------
 * Le middleware protège `/compte`, mais il ne fait que constater la présence
 * d'un cookie : il tourne sur le moteur périphérique, sans accès à la base. La
 * vérification qui fait autorité est celle-ci.
 *
 * ---------------------------------------------------------------------------
 * Ce qui appelle un geste passe devant
 * ---------------------------------------------------------------------------
 * Un prix payable expire ; un refus d'il y a trois semaines, non. Les remonter
 * en tête n'est pas une mise en scène de l'urgence — le brief interdit les faux
 * compteurs — mais l'ordre de lecture qu'appelle une liste dont deux lignes
 * seulement demandent quelque chose. À l'intérieur de chaque groupe, l'ordre
 * reste chronologique, donc stable d'une visite à l'autre.
 */
export default async function AccountOffersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}/connexion?suite=/compte/offres`)

  const t = await getTranslations('offers')
  const offers = await listOffers(user.id, locale)

  // Tri STABLE : `sort` de V8 l'est depuis longtemps, et l'ordre d'arrivée est
  // déjà celui qu'on veut à l'intérieur d'un groupe.
  const ordered = [...offers].sort((a, b) => {
    const left = offerNeedsAttention(a.standing) ? 0 : 1
    const right = offerNeedsAttention(b.standing) ? 0 : 1
    return left - right
  })

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('registerTitle')}</h1>

      {/*
        Dit d'emblée, et pas seulement sur les lignes concernées : c'est la
        règle qui explique tout le reste de la page, y compris pourquoi une
        offre acceptée peut se retrouver « sans objet ».
      */}
      <p className="mt-3 max-w-prose text-sm text-muted">{t('registerIntro')}</p>

      {ordered.length === 0 ? (
        <div className="mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('emptyRegister')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyRegisterHint')}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/catalogue">{t('backToCatalogue')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
          {ordered.map((offer) => (
            <OfferRegisterRow key={offer.id} offer={offer} />
          ))}
        </ul>
      )}
    </div>
  )
}
