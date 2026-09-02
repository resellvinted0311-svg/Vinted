import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils/cn'
import { formatPrice, formatGrams, discountPercent } from '@/lib/utils/format'
import type { PublicArticleCard } from '@/lib/db/selectors'
import { isReservationLive } from '@/lib/db/visibility'
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
 * Fiche d'inventaire.
 *
 * La vignette est traitée comme une fiche cartonnée d'atelier : contour plein,
 * angle vif, numéro de référence sous la photo, ligne de données factuelles.
 * C'est là que se joue la thèse de la charte — l'écologie se démontre par la
 * traçabilité de la pièce, pas par un symbole apposé à côté du prix.
 *
 * Au survol, la fiche pivote d'un demi-degré et découvre une ombre pleine :
 * le geste d'une carte qu'on soulève d'une pile. Il est porté par `.card-pick`
 * et ne s'applique qu'aux pointeurs qui survolent réellement.
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

  // Ligne de régie : ce qu'on veut savoir d'une pièce d'occasion avant même de
  // cliquer. Uniquement des champs réellement renseignés — pas de tiret pour
  // combler un trou.
  const facts = [
    article.sizeLabel,
    article.material ? t(`materials.${article.material}`) : null,
    formatGrams(article.weightGrams, locale),
  ].filter(Boolean)

  return (
    // `overflow-hidden` sur la fiche : sans lui, la photo déborderait des
    // angles arrondis du contour.
    <article className="card-pick group relative flex flex-col overflow-hidden rounded-card bg-paper-raised ruled">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-sand ruled-b">
        {cover ? (
          <ArticleImage image={cover} sizes={sizes} priority={priority} />
        ) : (
          // Sans photo, un lavis rose → cuivre occupe le cadre. Le vide est
          // habité et il porte la teinte du site, là où le quadrillage qu'il
          // remplace disait « image cassée ».
          <div className="wash-accent h-full w-full" aria-hidden />
        )}

        {/* Mention honnête : la réservation est réelle et temporaire. Ce n'est
            pas un compteur d'urgence inventé — et elle disparaît à l'échéance,
            sans attendre que le balayage soit passé. */}
        {isReservationLive(article) ? (
          <span className="label-reg absolute left-2 top-2 rounded-input border-[1.5px] border-rule bg-paper px-1.5 py-0.5 text-ink">
            {t('beingPurchased')}
          </span>
        ) : null}

        {discount !== null ? (
          <span className="label-reg absolute right-2 top-2 rounded-input border-[1.5px] border-mark bg-mark px-1.5 py-0.5 text-ink-inverse">
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

      <div className="flex flex-1 flex-col gap-1 p-3">
        {/* Référence d'inventaire. Donnée réelle — c'est le SKU, celui qui
            figure sur la facture et sur le colis. */}
        <p className="data text-xs text-muted">{article.sku}</p>

        {/* Le lien couvre toute la fiche sans emprisonner le bouton favori
            dans une ancre imbriquée, ce qui serait invalide. */}
        <h3 className="font-display text-base font-semibold uppercase leading-tight tracking-tight">
          <Link
            href={`/a/${article.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {translation?.title ?? article.sku}
          </Link>
        </h3>

        {article.brand ? (
          <p className="text-xs text-muted">{article.brand.name}</p>
        ) : null}

        <p className="data mt-auto pt-2 text-xs text-muted">
          {facts.join(' · ')}
        </p>

        <p className="flex items-baseline gap-2 border-t border-sand pt-2">
          {/* `data-numeric` ne marque QUE le montant courant : les tests de tri
              extraient les prix d'une grille par ce sélecteur, une remise ou un
              poids qui le porterait fausserait la lecture. */}
          <span
            data-numeric
            className={cn(
              'font-display text-lg font-bold tracking-tight',
              discount !== null ? 'text-mark' : 'text-ink',
            )}
          >
            {formatPrice(article.priceCents, locale)}
          </span>
          {discount !== null && article.comparePriceCents ? (
            <span className="data text-xs text-muted line-through">
              {formatPrice(article.comparePriceCents, locale)}
            </span>
          ) : null}
        </p>
      </div>
    </article>
  )
}

/**
 * Grille dense et régulière.
 *
 * L'espacement est plus généreux que la normale : les fiches pivotent au
 * survol, et sans marge elles se chevaucheraient.
 */
export function ArticleGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
      {children}
    </div>
  )
}

/** Valeur de `sizes` cohérente avec la grille ci-dessus. */
export const GRID_IMAGE_SIZES =
  '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw'
