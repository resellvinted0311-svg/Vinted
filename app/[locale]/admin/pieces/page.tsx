import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { listOwnArticles } from '@/lib/db/queries/admin-articles'
import { formatPrice, formatDate } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('articles.title'), robots: { index: false, follow: false } }
}

/**
 * L'inventaire, vu depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Ce que cette page rend possible et qui ne l'était pas
 * ---------------------------------------------------------------------------
 * Jusqu'ici, seules l'API de synchronisation et la baisse automatique
 * écrivaient un article : la boutique dépendait entièrement de l'application
 * compagnon pour avoir du stock. Corriger une description un dimanche soir
 * demandait une console.
 *
 * ---------------------------------------------------------------------------
 * Les pièces IMPORTÉES ne sont pas listées
 * ---------------------------------------------------------------------------
 * Elles appartiennent au partenaire. Les proposer ici laisserait croire qu'on
 * peut les corriger, alors que le prochain import écraserait le travail sans un
 * mot.
 *
 * ---------------------------------------------------------------------------
 * Le coût d'achat est affiché, et c'est assumé
 * ---------------------------------------------------------------------------
 * Ce sont les données de l'entreprise, rendues à l'entreprise — l'écran des
 * offres tient déjà la même position. Ce qui compte n'est pas qu'ils soient
 * absents ici, mais qu'ils n'apparaissent nulle part côté public.
 */
export default async function AdminArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin.articles')
  const articles = await listOwnArticles(locale)

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl">{t('title')}</h1>
        <Link
          href={`/${locale}/admin/pieces/nouvelle`}
          className="label-reg text-muted hover:text-ink"
        >
          {t('new')}
        </Link>
      </div>

      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      {articles.length === 0 ? (
        <div className="grid-reg mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('empty')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
          {articles.map((article) => (
            <li key={article.id} className="flex flex-wrap items-center gap-4 py-4">
              {article.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={article.thumbnailUrl}
                  alt=""
                  className="size-16 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <span
                  className="flex size-16 items-center justify-center rounded border border-dashed border-rule text-[10px] text-muted"
                  aria-hidden
                >
                  {t('noPhoto')}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <Link
                  href={`/${locale}/admin/pieces/${article.id}`}
                  className="text-base text-ink underline-offset-4 hover:underline"
                >
                  {article.title}
                </Link>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                  <span data-numeric>{article.sku}</span>
                  <span>{t(`statuses.${article.status}`)}</span>
                  {article.publishedAt ? (
                    <span>{formatDate(article.publishedAt, locale)}</span>
                  ) : null}
                  {article.imageCount === 0 ? (
                    <span className="text-danger">{t('noPhotoYetShort')}</span>
                  ) : null}
                </p>
              </div>

              <div className="text-right text-xs text-muted">
                <p data-numeric className="text-base text-ink">
                  {formatPrice(article.priceCents, locale)}
                </p>
                {/* Le coût et le plancher côte à côte : c'est la seule façon de
                    voir d'un coup d'œil ce qu'une négociation peut encore
                    céder. */}
                <p data-numeric>
                  {t('costAndFloor', {
                    cost: formatPrice(article.costCents, locale),
                    floor: formatPrice(article.floorPriceCents, locale),
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
