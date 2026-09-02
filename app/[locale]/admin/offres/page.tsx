import type { Metadata } from 'next'
import { getTranslations, setRequestLocale, getFormatter } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { ArticleImage } from '@/components/shop/article-image'
import { OfferResponseForm } from '@/components/admin/offer-response-form'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { listPendingOffers } from '@/lib/db/queries/admin-offers'
import { formatPrice, formatDate } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('offers'), robots: { index: false, follow: false } }
}

/**
 * Les offres qui attendent une décision.
 *
 * ---------------------------------------------------------------------------
 * Cette page montre ce qu'aucune autre ne montre
 * ---------------------------------------------------------------------------
 * Prix plancher, coût d'achat, écart au plancher. Ce sont les trois chiffres
 * sans lesquels une décision se prend au jugé, et ils ne sortent nulle part
 * ailleurs du serveur — c'est la seule page du projet où ils traversent la
 * frontière du navigateur. Ce qui rend cela sûr n'est pas la discrétion : c'est
 * `requireAdmin()`, ici, dans le layout, et dans l'action de réponse.
 *
 * ---------------------------------------------------------------------------
 * L'ordre est celui de l'urgence réelle, pas de la nouveauté
 * ---------------------------------------------------------------------------
 * Ce qui expire en premier passe devant. Une offre sans réponse s'éteint seule
 * au bout du délai réglé : trier par date de dépôt laisserait mourir en bas de
 * page celles qui n'ont plus que quelques heures.
 */
export default async function AdminOffersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Rattrapé plutôt que laissé remonter : sans cela, chaque accès refusé
  // inscrivait une erreur non gérée dans les journaux du serveur, à côté du
  // 404 que le layout produisait déjà correctement.
  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin')
  const format = await getFormatter({ locale })
  const offers = await listPendingOffers(locale)

  return (
    <div>
      <h1 className="text-2xl">{t('offers')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('offersIntro')}</p>

      {offers.length === 0 ? (
        <div className="mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('noPendingOffers')}</p>
          <p className="mt-1 text-xs text-muted">{t('noPendingOffersHint')}</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
          {offers.map((offer) => (
            <li key={offer.id} className="flex flex-col gap-4 py-6 sm:flex-row">
              <div
                className="relative h-24 w-20 shrink-0 overflow-hidden rounded-input bg-paper-raised"
                aria-hidden="true"
              >
                {offer.article.image ? (
                  <ArticleImage image={offer.article.image} sizes="80px" />
                ) : null}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/a/${offer.article.slug}`}
                    className="text-base text-ink underline-offset-4 hover:underline"
                  >
                    {offer.article.title}
                  </Link>
                  <span className="data text-xs text-muted">{offer.article.sku}</span>
                  {offer.article.isSold ? <Badge tone="sold">{t('sold')}</Badge> : null}
                  {offer.lapsed ? <Badge tone="warning">{t('lapsed')}</Badge> : null}
                </div>

                {/*
                  Les chiffres de la décision, alignés en chasse fixe. L'écart
                  au plancher est calculé serveur : le faire de tête sur une
                  file de vingt offres est le meilleur moyen de se tromper une
                  fois.
                */}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <Figure label={t('offered')} tone="ink">
                    {formatPrice(offer.amountCents, locale)}
                  </Figure>
                  <Figure label={t('listed')}>
                    {formatPrice(offer.article.priceCents, locale)}
                  </Figure>
                  <Figure label={t('floor')}>
                    {formatPrice(offer.article.floorPriceCents, locale)}
                  </Figure>
                  <Figure
                    label={t('marginToFloor')}
                    tone={offer.belowFloor ? 'danger' : 'muted'}
                  >
                    {format.number(offer.marginToFloorCents / 100, {
                      style: 'currency',
                      currency: 'EUR',
                      signDisplay: 'always',
                    })}
                  </Figure>
                </dl>

                <p className="text-xs text-muted">
                  {t('receivedFrom', {
                    from: offer.from,
                    date: formatDate(offer.createdAt, locale),
                  })}
                  {' · '}
                  {t('answerBy', { date: formatDate(offer.expiresAt, locale) })}
                </p>

                {offer.belowFloor ? (
                  <p className="text-xs text-danger">{t('belowFloorWarning')}</p>
                ) : null}

                <OfferResponseForm
                  offerId={offer.id}
                  belowFloor={offer.belowFloor}
                  hasAccount={offer.hasAccount}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Un chiffre avec son intitulé, en chasse fixe comme toute donnée de régie. */
function Figure({
  label,
  children,
  tone = 'muted',
}: {
  label: string
  children: React.ReactNode
  tone?: 'ink' | 'muted' | 'danger'
}) {
  const color =
    tone === 'ink' ? 'text-ink' : tone === 'danger' ? 'text-danger' : 'text-muted'

  return (
    <div className="flex flex-col">
      <dt className="label-reg text-muted">{label}</dt>
      <dd data-numeric className={`${color} tabular-nums`}>
        {children}
      </dd>
    </div>
  )
}
