import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Wordmark } from '@/components/shop/wordmark'
import { getLatestArticles } from '@/lib/db/queries/articles'
import { getCategoryTree, listBrandsWithCounts } from '@/lib/db/queries/taxonomy'
import { ArticleCard } from '@/components/shop/article-card'

/**
 * Rendu statique régénéré toutes les 60 secondes.
 *
 * L'accueil porte le référencement et la cible LCP : il reste prérendu. En
 * Phase 2, la régénération sera aussi déclenchée à la demande au changement
 * de statut d'un article, pour qu'une pièce vendue quitte la vitrine sans
 * attendre l'échéance.
 */
export const revalidate = 60

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('home')
  const tNav = await getTranslations('nav')

  const [latest, categories, brands] = await Promise.all([
    getLatestArticles(locale, 7),
    getCategoryTree(locale),
    listBrandsWithCounts(),
  ])

  const [hero, ...rest] = latest

  return (
    <>
      <section className="border-b border-sand">
        <div className="mx-auto max-w-[80rem] px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <Wordmark size="lg" />
            <p className="mt-8 text-lg text-ink">{t('intro')}</p>
          </div>
        </div>
      </section>

      {latest.length === 0 ? (
        <section className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
          <div className="border border-sand bg-surface p-8 rounded-card">
            <p className="text-base text-ink">{t('emptyCatalogue')}</p>
            <p className="mt-1 text-xs text-muted">{t('emptyCatalogueHint')}</p>
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl">{t('newArrivals')}</h2>
            <Link
              href="/catalogue"
              className="text-base text-muted underline underline-offset-4 hover:text-ink"
            >
              {t('seeAll')}
            </Link>
          </div>

          {/* Grille éditoriale asymétrique : la première pièce occupe deux
              colonnes et deux rangées. C'est ce qui distingue une vitrine
              d'une grille produit standard. */}
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
            {hero ? (
              <div className="col-span-2 row-span-2">
                <ArticleCard
                  article={hero}
                  locale={locale}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  priority
                />
              </div>
            ) : null}

            {rest.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                locale={locale}
                sizes="(min-width: 1024px) 25vw, 50vw"
              />
            ))}
          </div>
        </section>
      )}

      {/* Entrées par catégorie et par marque : deux façons d'attaquer le
          catalogue, à côté de la recherche. */}
      <section className="border-t border-sand bg-paper-raised">
        <div className="mx-auto grid max-w-[80rem] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-xl">{t('shopByCategory')}</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {categories.flatMap((root) =>
                (root.children.length > 0 ? root.children : [root]).map(
                  (category) => (
                    <li key={category.id}>
                      <Link
                        href={`/c/${root.children.length > 0 ? `${root.slug}/${category.slug}` : category.slug}`}
                        className="inline-flex min-h-[44px] items-center rounded-input border border-sand-strong bg-surface px-3 text-base text-ink transition-colors duration-150 ease-out hover:border-ink"
                      >
                        {category.name}
                      </Link>
                    </li>
                  ),
                ),
              )}
            </ul>
          </div>

          <div>
            <h2 className="text-xl">{t('shopByBrand')}</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {brands.map((brand) => (
                <li key={brand.id}>
                  <Link
                    href={`/marque/${brand.slug}`}
                    className="inline-flex min-h-[44px] items-center rounded-input border border-sand-strong bg-surface px-3 text-base text-ink transition-colors duration-150 ease-out hover:border-ink"
                  >
                    {brand.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/marques"
              className="mt-4 inline-block text-base text-muted underline underline-offset-4 hover:text-ink"
            >
              {tNav('brands')}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-sand">
        <div className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
          <h2 className="text-xl">{t('howItWorks.title')}</h2>

          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
            <article>
              <h3 className="text-lg">{t('howItWorks.sourcingTitle')}</h3>
              <p className="mt-2 text-base text-muted">
                {t('howItWorks.sourcingBody')}
              </p>
            </article>

            <article>
              <h3 className="text-lg">{t('howItWorks.selectionTitle')}</h3>
              <p className="mt-2 text-base text-muted">
                {t('howItWorks.selectionBody')}
              </p>
            </article>

            <article>
              <h3 className="text-lg">{t('howItWorks.shippingTitle')}</h3>
              <p className="mt-2 text-base text-muted">
                {t('howItWorks.shippingBody')}
              </p>
            </article>
          </div>
        </div>
      </section>
    </>
  )
}
