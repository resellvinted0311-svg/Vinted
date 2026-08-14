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
import { Button } from '@/components/ui/button'
import { Stamp } from '@/components/ui/stamp'
import {
  formatPrice,
  discountPercent,
  formatDate,
  formatGrams,
} from '@/lib/utils/format'
import { locales, localeTags } from '@/lib/i18n/routing'
import { SITE } from '@/lib/config/site'
import { serializeJsonLd } from '@/lib/utils/json-ld'

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
    <div className="mx-auto max-w-[80rem] px-4 pb-24 pt-6 sm:px-6">
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
            <p className="label-reg text-muted">{categoryName}</p>
            <h1 className="mt-2 text-2xl">{translation?.title ?? article.sku}</h1>

            {article.brand ? (
              <Link
                href={`/marque/${article.brand.slug}`}
                className="mt-2 inline-block text-base text-muted underline underline-offset-4 hover:text-ink"
              >
                {article.brand.name}
              </Link>
            ) : null}
          </div>

          <div className="flex flex-wrap items-baseline gap-3 border-y border-sand py-4">
            <span
              data-numeric
              className={`font-display text-2xl font-bold tracking-tight ${
                discount !== null ? 'text-mark' : 'text-ink'
              }`}
            >
              {formatPrice(article.priceCents, locale)}
            </span>

            {discount !== null && article.comparePriceCents ? (
              <>
                <span className="data text-base text-muted line-through">
                  {formatPrice(article.comparePriceCents, locale)}
                </span>
                <Badge tone="mark">
                  −{discount} %
                  {article.lastPriceDropAt
                    ? ` · ${formatDate(article.lastPriceDropAt, locale)}`
                    : ''}
                </Badge>
              </>
            ) : null}

            {/* Fait de stock, pas argument : le stock est unitaire par
                construction, l'afficher ne fabrique aucune urgence. */}
            {!isSold ? (
              <Stamp className="ml-auto">{t('uniquePiece')}</Stamp>
            ) : null}
          </div>

          {/* État de stock — factuel, jamais alarmiste. */}
          {isSold ? (
            <div className="rounded-card ruled bg-paper-raised p-4">
              <p className="text-base text-ink">{t('sold')}</p>
              <p className="mt-1 text-xs text-muted">{t('soldHint')}</p>
            </div>
          ) : isReserved ? (
            <div className="rounded-card ruled bg-paper-raised p-4">
              <p className="text-base text-ink">{t('reserved')}</p>
              <p className="mt-1 text-xs text-muted">{t('reservedHint')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Panier et offres arrivent en Phases 2 et 3 : les commandes
                  sont annoncées mais désactivées, plutôt qu'absentes. */}
              <Button size="lg" disabled fullWidth>
                {t('addToCart')}
              </Button>

              {offersOpen ? (
                <Button variant="outline" disabled fullWidth>
                  {t('makeOffer')}
                </Button>
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
            />
            <span className="label-reg text-muted">
              {tCat('addToFavorites')}
            </span>
          </div>

          <section>
            <h2 className="border-b border-sand pb-2 text-lg">
              {t('description')}
            </h2>
            <p className="mt-3 whitespace-pre-line text-base text-ink">
              {translation?.description}
            </p>
            {translation?.isMachineTranslated ? (
              <p className="mt-2 text-xs text-muted">{t('machineTranslated')}</p>
            ) : null}
          </section>

          {/*
            Bloc d'identification.

            C'est ici que se joue la thèse de la charte : l'écologie se
            démontre en disant ce que la pièce EST — référence, matière, poids
            réel, date d'entrée — plutôt qu'en affichant un symbole. Toutes ces
            valeurs viennent de la base ; aucune n'est estimée ni arrondie pour
            faire joli, et celles qui manquent ne sont pas affichées.
          */}
          <section>
            <h2 className="border-b border-sand pb-2 text-lg">{t('details')}</h2>

            <dl className="mt-1">
              <Row label={t('condition')} note={tc(`${article.condition}.help`)}>
                {tc(`${article.condition}.label`)}
              </Row>

              <Row label={t('size')}>{article.sizeLabel}</Row>

              {article.material ? (
                <Row label={t('material')}>
                  {tCat(`materials.${article.material}`)}
                </Row>
              ) : null}

              {article.color ? (
                <Row label={t('color')}>{tCat(`colors.${article.color}`)}</Row>
              ) : null}

              {article.fit ? (
                <Row label={t('fit')}>{tCat(`fits.${article.fit}`)}</Row>
              ) : null}

              <Row label={t('weight')}>
                {formatGrams(article.weightGrams, locale)}
              </Row>

              <Row label={t('reference')}>{article.sku}</Row>

              {article.publishedAt ? (
                <Row label={t('identification')}>
                  {t('addedOn', {
                    date: formatDate(article.publishedAt, locale),
                  })}
                </Row>
              ) : null}
            </dl>
          </section>

          <MeasurementsTable
            measurements={article.measurements}
            locale={locale}
          />
        </div>
      </div>

      {similar.length > 0 ? (
        <section className="mt-16 ruled-t pt-10">
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
    </div>
  )
}

/**
 * Ligne du bloc d'identification.
 *
 * Intitulé en étiquette de régie à gauche, valeur en chasse fixe à droite,
 * filet sable entre chaque : la même grammaire que le tableau de mesures, pour
 * que les deux se lisent comme un seul relevé.
 */
function Row({
  label,
  children,
  note,
}: {
  label: string
  children: React.ReactNode
  /**
   * Précision en prose, sous la ligne. Elle reste en composition courante et
   * alignée à gauche : une phrase en chasse fixe alignée à droite se lit comme
   * une donnée tabulaire, ce qu'elle n'est pas.
   */
  note?: string
}) {
  return (
    <div className="border-b border-sand py-2.5">
      <div className="flex items-baseline justify-between gap-6">
        <dt className="label-reg shrink-0 text-muted">{label}</dt>
        <dd className="data text-right text-base text-ink">{children}</dd>
      </div>
      {note ? (
        <p className="mt-1 font-sans text-xs text-muted">{note}</p>
      ) : null}
    </div>
  )
}
