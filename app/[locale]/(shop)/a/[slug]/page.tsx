import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import {
  getArticleBySlug,
  getSimilarArticles,
} from '@/lib/db/queries/articles'
import { getCategoryPath } from '@/lib/db/queries/taxonomy'
import { pickTranslation, ArticleCard, ArticleGrid } from '@/components/shop/article-card'
import { ArticleGallery } from '@/components/shop/article-gallery'
import { MeasurementsTable } from '@/components/shop/measurements-table'
import { FavoriteButton } from '@/components/shop/favorite-button'
import { Breadcrumbs } from '@/components/shop/breadcrumbs'
import { Badge } from '@/components/ui/badge'
import { formatPrice, discountPercent, formatDate } from '@/lib/utils/format'
import { locales, localeTags } from '@/lib/i18n/routing'
import { SITE } from '@/lib/config/site'

type Params = Promise<{ locale: string; slug: string }>

/** L'état d'un article change à chaque vente : régénération courte. */
export const revalidate = 60

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { locale, slug } = await params
  const article = await getArticleBySlug(slug, locale)
  if (!article) return {}

  const translation = pickTranslation(article.translations, locale)
  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/a/${slug}`]),
  )
  languages['x-default'] = `/fr/a/${slug}`

  const cover = article.images[0]

  return {
    title: translation?.title ?? article.sku,
    description: translation?.description.slice(0, 300),
    alternates: { canonical: `/${locale}/a/${slug}`, languages },
    openGraph: {
      title: translation?.title ?? article.sku,
      description: translation?.description.slice(0, 300),
      type: 'website',
      images: cover ? [{ url: cover.url, width: cover.width, height: cover.height }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: translation?.title ?? article.sku,
      images: cover ? [cover.url] : [],
    },
    // Un article vendu reste indexable : c'est du référencement acquis.
    robots: { index: true, follow: true },
  }
}

export default async function ArticlePage({ params }: { params: Params }) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const article = await getArticleBySlug(slug, locale)
  if (!article) notFound()

  const t = await getTranslations('article')
  const tc = await getTranslations('condition')
  const tCat = await getTranslations('catalogue')
  const tNav = await getTranslations('nav')

  const translation = pickTranslation(article.translations, locale)
  const isSold = article.status === 'SOLD'
  const isReserved = article.status === 'RESERVED'
  const discount = discountPercent(article.priceCents, article.comparePriceCents)

  const [similar, categoryPath] = await Promise.all([
    getSimilarArticles(
      {
        excludeId: article.id,
        categoryId: article.category.id,
        brandId: article.brand?.id ?? null,
        sizeNormalized: article.sizeNormalized,
      },
      locale,
      isSold ? 4 : 4,
    ),
    getCategoryPath(article.category.slug),
  ])

  const categoryName =
    article.category.translations.find((entry) => entry.locale === locale)
      ?.name ??
    article.category.translations.find((entry) => entry.locale === 'fr')?.name ??
    article.category.slug

  const offersOpen =
    article.allowOffers &&
    article.offersOpenAt !== null &&
    article.offersOpenAt <= new Date()

  // JSON-LD : la disponibilité reflète l'état réel, y compris SoldOut.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: translation?.title ?? article.sku,
    description: translation?.description,
    sku: article.sku,
    ...(article.brand
      ? { brand: { '@type': 'Brand', name: article.brand.name } }
      : {}),
    ...(article.color ? { color: tCat(`colors.${article.color}`) } : {}),
    ...(article.material ? { material: tCat(`materials.${article.material}`) } : {}),
    size: article.sizeLabel,
    image: article.images.map((image) => `${SITE.url}${image.url}`),
    itemCondition:
      article.condition === 'NEW_WITH_TAGS' ||
      article.condition === 'NEW_WITHOUT_TAGS'
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
    offers: {
      '@type': 'Offer',
      url: `${SITE.url}/${locale}/a/${article.slug}`,
      priceCurrency: SITE.currency,
      price: (article.priceCents / 100).toFixed(2),
      availability: isSold
        ? 'https://schema.org/SoldOut'
        : 'https://schema.org/InStock',
      itemCondition:
        article.condition === 'NEW_WITH_TAGS'
          ? 'https://schema.org/NewCondition'
          : 'https://schema.org/UsedCondition',
      // Stock unitaire : il n'y a jamais qu'un exemplaire.
      inventoryLevel: { '@type': 'QuantitativeValue', value: isSold ? 0 : 1 },
    },
  }

  return (
    <div className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { href: '/catalogue', label: tNav('catalogue') },
          { href: `/c/${categoryPath.join('/')}`, label: categoryName },
          { href: null, label: translation?.title ?? article.sku },
        ]}
      />

      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ArticleGallery
          images={article.images}
          title={translation?.title ?? article.sku}
          soldLabel={isSold ? t('sold') : null}
        />

        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl">{translation?.title ?? article.sku}</h1>

            {article.brand ? (
              <Link
                href={`/marque/${article.brand.slug}`}
                className="mt-1 inline-block text-base text-muted underline underline-offset-4 hover:text-ink"
              >
                {article.brand.name}
              </Link>
            ) : null}
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <span
              data-numeric
              className={`text-2xl ${discount !== null ? 'text-clay' : 'text-ink'}`}
            >
              {formatPrice(article.priceCents, locale)}
            </span>

            {discount !== null && article.comparePriceCents ? (
              <>
                <span data-numeric className="text-base text-muted line-through">
                  {formatPrice(article.comparePriceCents, locale)}
                </span>
                <Badge tone="clay">
                  −{discount} %
                  {article.lastPriceDropAt
                    ? ` · ${formatDate(article.lastPriceDropAt, locale)}`
                    : ''}
                </Badge>
              </>
            ) : null}
          </div>

          {/* État de stock — factuel, jamais alarmiste. */}
          {isSold ? (
            <div className="border border-sand bg-paper-raised p-4 rounded-card">
              <p className="text-base text-ink">{t('sold')}</p>
              <p className="mt-1 text-xs text-muted">{t('soldHint')}</p>
            </div>
          ) : isReserved ? (
            <div className="border border-sand bg-paper-raised p-4 rounded-card">
              <p className="text-base text-ink">{t('reserved')}</p>
              <p className="mt-1 text-xs text-muted">{t('reservedHint')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Panier et offres arrivent en Phases 2 et 3 : les commandes
                  sont annoncées mais désactivées, plutôt qu'absentes. */}
              <button
                type="button"
                disabled
                className="min-h-[52px] w-full rounded-input border border-moss bg-moss px-6 text-base text-ink-inverse disabled:opacity-50"
              >
                {t('addToCart')}
              </button>

              {offersOpen ? (
                <button
                  type="button"
                  disabled
                  className="min-h-[44px] w-full rounded-input border border-sand-strong px-6 text-base text-ink disabled:opacity-50"
                >
                  {t('makeOffer')}
                </button>
              ) : article.allowOffers && article.offersOpenAt ? (
                <p className="text-xs text-muted">
                  {t('offersOpenOn', {
                    date: formatDate(article.offersOpenAt, locale),
                  })}
                </p>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-3">
            <FavoriteButton
              articleId={article.id}
              label={tCat('addToFavorites')}
              labelRemove={tCat('removeFromFavorites')}
              size="lg"
              className="border border-sand-strong"
            />
            <span className="text-xs text-muted">{tCat('addToFavorites')}</span>
          </div>

          <section>
            <h2 className="text-lg">{t('description')}</h2>
            <p className="mt-2 whitespace-pre-line text-base text-ink">
              {translation?.description}
            </p>
            {translation?.isMachineTranslated ? (
              <p className="mt-2 text-xs text-muted">{t('machineTranslated')}</p>
            ) : null}
          </section>

          <section>
            <h2 className="text-lg">{t('details')}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-base">
              <dt className="text-muted">{t('condition')}</dt>
              <dd className="text-ink">
                {tc(`${article.condition}.label`)}
                <span className="block text-xs text-muted">
                  {tc(`${article.condition}.help`)}
                </span>
              </dd>

              <dt className="text-muted">{t('size')}</dt>
              <dd className="text-ink">{article.sizeLabel}</dd>

              {article.material ? (
                <>
                  <dt className="text-muted">{t('material')}</dt>
                  <dd className="text-ink">
                    {tCat(`materials.${article.material}`)}
                  </dd>
                </>
              ) : null}

              {article.color ? (
                <>
                  <dt className="text-muted">{t('color')}</dt>
                  <dd className="text-ink">{tCat(`colors.${article.color}`)}</dd>
                </>
              ) : null}

              {article.fit ? (
                <>
                  <dt className="text-muted">{t('fit')}</dt>
                  <dd className="text-ink">{tCat(`fits.${article.fit}`)}</dd>
                </>
              ) : null}

              <dt className="text-muted">{t('reference')}</dt>
              <dd data-numeric className="text-ink">
                {article.sku}
              </dd>
            </dl>
          </section>

          <MeasurementsTable
            measurements={article.measurements}
            locale={locale}
          />
        </div>
      </div>

      {similar.length > 0 ? (
        <section className="mt-16 border-t border-sand pt-10">
          <h2 className="text-xl">
            {isSold ? t('similarAvailable') : t('similar')}
          </h2>
          <div className="mt-6">
            <ArticleGrid>
              {similar.map((entry) => (
                <ArticleCard
                  key={entry.id}
                  article={entry}
                  locale={locale}
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                />
              ))}
            </ArticleGrid>
          </div>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  )
}
