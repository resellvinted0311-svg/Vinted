import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils/cn'
import { formatPrice, discountPercent } from '@/lib/utils/format'
import type { PublicArticleCard } from '@/lib/db/selectors'
import { ArticleImage } from './article-image'
import { FavoriteButton } from './favorite-button'

/** Retient la traduction demandée, ou le français à défaut. */
export function pickTranslation<T extends { locale: string }>(
  translations: T[],
  locale: string,
): T | undefined {
  return (
    translations.find((entry) => entry.locale === locale) ??
    translations.find((entry) => entry.locale === 'fr') ??
    translations[0]
  )
}

/**
 * Vignette de catalogue.
 *
 * La photo occupe tout le cadre : pas de carte à ombre portée autour, pas de
 * rayon marqué. Le texte vit sous l'image, aligné à gauche, sans centrage
 * décoratif.
 */
export async function ArticleCard({
  article,
  locale,
  sizes,
  priority = false,
}: {
  article: PublicArticleCard
  locale: string
  sizes: string
  priority?: boolean
}) {
  const t = await getTranslations('catalogue')
  const translation = pickTranslation(article.translations, locale)
  const cover = article.images[0]
  const discount = discountPercent(article.priceCents, article.comparePriceCents)

  return (
    <article className="group relative flex flex-col">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-sand">
        {cover ? (
          <ArticleImage image={cover} sizes={sizes} priority={priority} />
        ) : null}

        {/* Mention honnête : la réservation est réelle et temporaire. Ce n'est
            pas un compteur d'urgence inventé. */}
        {article.status === 'RESERVED' ? (
          <span className="absolute left-2 top-2 bg-paper px-2 py-0.5 text-xs text-muted">
            {t('beingPurchased')}
          </span>
        ) : null}

        {discount !== null ? (
          <span
            data-numeric
            className="absolute right-2 top-2 bg-clay px-2 py-0.5 text-xs text-ink-inverse"
          >
            −{discount} %
          </span>
        ) : null}

        <div className="absolute bottom-2 right-2">
          <FavoriteButton
            articleId={article.id}
            label={t('addToFavorites')}
            labelRemove={t('removeFromFavorites')}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {/* Le lien couvre toute la vignette sans emprisonner le bouton favori
            dans une ancre imbriquée, ce qui serait invalide. */}
        <h3 className="text-base leading-snug">
          <Link
            href={`/a/${article.slug}`}
            className="after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-4"
          >
            {translation?.title ?? article.sku}
          </Link>
        </h3>

        <p className="text-xs text-muted">
          {[article.brand?.name, article.sizeLabel].filter(Boolean).join(' · ')}
        </p>

        <p className="mt-1 flex items-baseline gap-2">
          <span
            data-numeric
            className={cn('text-base', discount !== null && 'text-clay')}
          >
            {formatPrice(article.priceCents, locale)}
          </span>
          {discount !== null && article.comparePriceCents ? (
            <span data-numeric className="text-xs text-muted line-through">
              {formatPrice(article.comparePriceCents, locale)}
            </span>
          ) : null}
        </p>
      </div>
    </article>
  )
}

/** Grille dense et régulière, à l'inverse de l'accueil qui est éditorial. */
export function ArticleGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  )
}

/** Valeur de `sizes` cohérente avec la grille ci-dessus. */
export const GRID_IMAGE_SIZES =
  '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw'
