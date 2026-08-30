import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import {
  getOwnArticle,
  listLeafCategories,
} from '@/lib/db/queries/admin-articles'
import { availableListingActions, isEditable } from '@/lib/domain/article-listing'
import { MAX_IMAGES } from '@/lib/validation/sync'
import { ArticleForm } from '@/components/admin/article-form'
import { ArticleImages } from '@/components/admin/article-images'
import { ArticleListingForm } from '@/components/admin/article-listing-form'
import { formatPrice } from '@/lib/utils/format'
import { Notice } from '@/components/ui/notice'

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

/** Les centimes, tels qu'ils se saisissent : en euros, avec la virgule. */
function toEuroText(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Une pièce : sa fiche, ses photos, sa mise en vente.
 *
 * ---------------------------------------------------------------------------
 * Trois blocs, et l'ordre compte
 * ---------------------------------------------------------------------------
 * Les photos d'abord, parce qu'une pièce sans visuel est le cas le plus fréquent
 * d'une fiche qu'on vient de créer, et que la photo est ce qui la fera vendre.
 * La mise en vente ensuite. La fiche descriptive en dernier : c'est ce qu'on
 * revient corriger, pas ce qu'on cherche en arrivant.
 *
 * ---------------------------------------------------------------------------
 * Le formulaire disparaît quand la pièce n'est plus modifiable
 * ---------------------------------------------------------------------------
 * Corriger le prix d'une pièce VENDUE réécrirait ce qu'une facture affirme ;
 * le corriger pendant un paiement en cours changerait le montant sous les yeux
 * de quelqu'un qui a déjà vu l'autre. Le serveur refuse dans les deux cas — ce
 * qui est fait ici est plus modeste : ne pas présenter un formulaire dont
 * l'enregistrement échouerait.
 */
export default async function AdminArticlePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)

  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin.articles')

  const article = await getOwnArticle(id)
  if (!article) notFound()

  const categories = await listLeafCategories(locale)

  const subject = {
    status: article.status,
    lockLive: article.lockLive,
    awaitingPayment: article.awaitingPayment,
  }
  const actions = availableListingActions(subject)
  const editable = isEditable(subject)

  return (
    <div className="flex flex-col gap-10">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl">{article.title}</h1>
          <Link
            href={`/${locale}/admin/pieces`}
            className="label-reg text-muted hover:text-ink"
          >
            {t('backToList')}
          </Link>
        </div>

        <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
          <span data-numeric>{article.sku}</span>
          <span>{t(`statuses.${article.status}`)}</span>
          <span data-numeric>
            {t('costAndFloor', {
              cost: formatPrice(article.costCents, locale),
              floor: formatPrice(article.floorPriceCents, locale),
            })}
          </span>
          {article.status === 'AVAILABLE' ? (
            <Link
              href={`/${locale}/a/${article.slug}`}
              className="underline-offset-4 hover:underline"
            >
              {t('viewPublic')}
            </Link>
          ) : null}
        </p>
      </div>

      <ArticleImages
        articleId={article.id}
        slug={article.slug}
        images={article.images}
        maxImages={MAX_IMAGES}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg">{t('listing')}</h2>
        <ArticleListingForm
          articleId={article.id}
          slug={article.slug}
          actions={actions}
          blockedReason={
            article.status === 'SOLD'
              ? 'sold'
              : article.lockLive
                ? 'reserved'
                : article.awaitingPayment
                  ? 'awaiting-payment'
                  : undefined
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg">{t('details')}</h2>

        {editable ? (
          <ArticleForm
            mode="edit"
            locale={locale}
            articleId={article.id}
            // L'horodatage lu MAINTENANT : l'enregistrement le comparera, et un
            // écart voudra dire que la pièce a bougé entre-temps.
            expectedUpdatedAt={article.updatedAt.toISOString()}
            categories={categories}
            floorPriceLabel={formatPrice(article.floorPriceCents, locale)}
            values={{
              categoryId: article.categoryId,
              brandName: article.brandName ?? '',
              condition: article.condition,
              sizeLabel: article.sizeLabel,
              color: article.color ?? '',
              material: article.material ?? '',
              fit: article.fit ?? '',
              title: article.title,
              description: article.description,
              priceEuros: toEuroText(article.priceCents),
              costEuros: toEuroText(article.costCents),
              weightGrams: String(article.weightGrams),
              allowOffers: article.allowOffers,
              autoDropEnabled: article.autoDropEnabled,
              sourcedFrom: article.sourcedFrom ?? '',
              internalNotes: article.internalNotes ?? '',
              measurements: Object.fromEntries(
                article.measurements.map((m) => [
                  m.key,
                  String(m.valueCm).replace('.', ','),
                ]),
              ),
            }}
          />
        ) : (
          <Notice tone="info" role="status">
            <p>{t('notEditable')}</p>
          </Notice>
        )}
      </div>
    </div>
  )
}
