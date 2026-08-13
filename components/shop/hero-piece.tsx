import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { formatPrice, formatGrams, formatDate } from '@/lib/utils/format'
import type { PublicArticleCard } from '@/lib/db/selectors'
import { ArticleImage } from './article-image'
import { pickTranslation } from './article-card'
import { Stamp } from '@/components/ui/stamp'
import { Reveal } from '@/components/motion/reveal'
import { PointerDrift } from '@/components/motion/pointer-drift'

/**
 * La pièce du moment.
 *
 * Premier écran de la boutique, et parti pris central de la refonte : on
 * n'arrive pas sur un rayon mais sur une vitrine. Une seule pièce, en grand,
 * avec son relevé complet — c'est ce qu'une boutique où chaque article est
 * unique peut faire et qu'un catalogue de tailles multiples ne peut pas.
 *
 * La composition est délibérément décentrée : le titre chevauche la
 * photographie, le relevé descend en colonne étroite le long du bord. Une
 * grille sage produirait la page d'accueil de n'importe quelle boutique.
 */
export async function HeroPiece({
  article,
  locale,
}: {
  article: PublicArticleCard
  locale: string
}) {
  const t = await getTranslations('home')
  const tArticle = await getTranslations('article')
  const tCat = await getTranslations('catalogue')

  const translation = pickTranslation(article.translations, locale)
  const title = translation?.title ?? article.sku
  const cover = article.images[0]

  const record: { label: string; value: string }[] = [
    { label: tArticle('reference'), value: article.sku },
    { label: tArticle('size'), value: article.sizeLabel },
    ...(article.material
      ? [
          {
            label: tArticle('material'),
            value: tCat(`materials.${article.material}`),
          },
        ]
      : []),
    {
      label: tArticle('weight'),
      value: formatGrams(article.weightGrams, locale),
    },
    ...(article.publishedAt
      ? [
          {
            label: tArticle('identification'),
            value: formatDate(article.publishedAt, locale),
          },
        ]
      : []),
  ]

  return (
    <section className="relative overflow-hidden ruled-b bg-paper">
      <div aria-hidden className="grid-reg absolute inset-0" />

      <div className="relative mx-auto max-w-[80rem] px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
        <Reveal>
          <p className="label-reg text-mark">{t('featured')}</p>
        </Reveal>

        {/*
          Sur grand écran, la photographie occupe six colonnes et le bloc de
          titre repart de la sixième : ils se chevauchent d'une colonne, et ce
          chevauchement est ce qui casse la grille produit.

          Les DEUX portent `row-start-1`. Placer un seul des deux
          explicitement suffit à rejeter l'autre en ligne suivante : le
          placement automatique refuse de traverser une cellule déjà occupée,
          et la photo se retrouvait sous le pli au lieu d'être derrière le
          titre.

          En dessous de lg, tout se remet en pile — superposer du texte sur
          une photo étroite le rendrait illisible.
        */}
        <div className="mt-6 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-6">
          <Reveal
            from="left"
            className="lg:col-span-6 lg:col-start-1 lg:row-start-1"
          >
            <Link
              href={`/a/${article.slug}`}
              className="group block overflow-hidden rounded-card ruled bg-sand"
            >
              <PointerDrift strength={16}>
                <div className="aspect-[4/5] w-full">
                  {cover ? (
                    <ArticleImage
                      image={cover}
                      sizes="(min-width: 1024px) 58vw, 100vw"
                      priority
                    />
                  ) : (
                    <div className="grid-reg h-full w-full" aria-hidden />
                  )}
                </div>
              </PointerDrift>
            </Link>
          </Reveal>

          <div className="relative z-10 mt-6 lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:mt-28">
            <Reveal delay={120}>
              <h1 className="type-hero font-display font-bold uppercase text-ink">
                <Link
                  href={`/a/${article.slug}`}
                  className="transition-colors duration-200 ease-out hover:text-stamp"
                >
                  {title}
                </Link>
              </h1>
            </Reveal>

            <Reveal delay={200}>
              {/*
                Le relevé est posé sur une fiche opaque : à cet endroit il
                déborde sur la photographie, et du texte fin sur un visuel ne
                se lit pas.
              */}
              <div className="mt-6 max-w-md rounded-card ruled bg-paper-raised p-5 lg:mt-8 lg:ml-auto">
                {article.brand ? (
                  <p className="label-reg text-muted">{article.brand.name}</p>
                ) : null}

                <p className="mt-3 flex items-baseline gap-3">
                  <span
                    data-numeric
                    className="font-display text-3xl font-bold tracking-tight text-ink"
                  >
                    {formatPrice(article.priceCents, locale)}
                  </span>
                  <Stamp>{tArticle('uniquePiece')}</Stamp>
                </p>

                <dl className="mt-5">
                  {record.map((entry) => (
                    <div
                      key={entry.label}
                      className="flex items-baseline justify-between gap-4 border-t border-sand py-2"
                    >
                      <dt className="label-reg text-muted">{entry.label}</dt>
                      <dd className="data text-base text-ink">{entry.value}</dd>
                    </div>
                  ))}
                </dl>

                <Link
                  href={`/a/${article.slug}`}
                  className="lift mt-5 inline-flex min-h-[48px] items-center rounded-input border-[1.5px] border-stamp bg-stamp px-6 font-medium text-ink-inverse"
                >
                  {t('featuredCta')}
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
