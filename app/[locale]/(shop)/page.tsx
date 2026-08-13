import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { SITE } from '@/lib/config/site'
import {
  getLatestArticles,
  countListedArticles,
} from '@/lib/db/queries/articles'
import { getCategoryTree, listBrandsWithCounts } from '@/lib/db/queries/taxonomy'
import { ArticleCard } from '@/components/shop/article-card'
import { BranchPlate } from '@/components/shop/engraving'

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
  const tSite = await getTranslations('site')
  const tNav = await getTranslations('nav')

  const [latest, categories, brands, total] = await Promise.all([
    getLatestArticles(locale, 7),
    getCategoryTree(locale),
    listBrandsWithCounts(),
    countListedArticles(),
  ])

  const [hero, ...rest] = latest

  // Les trois étapes forment une vraie séquence — on chine, on prépare, on
  // expédie — donc la numérotation porte une information. Ailleurs, un numéro
  // décoratif serait du remplissage.
  const steps = [
    { title: t('howItWorks.sourcingTitle'), body: t('howItWorks.sourcingBody') },
    {
      title: t('howItWorks.selectionTitle'),
      body: t('howItWorks.selectionBody'),
    },
    {
      title: t('howItWorks.shippingTitle'),
      body: t('howItWorks.shippingBody'),
    },
  ]

  return (
    <>
      {/* ------------------------------------------------------------------
          Bandeau de registre.

          La gravure y occupe un quart du cadre — c'est la seule échelle à
          laquelle le végétal est autorisé (voir engraving.tsx). Elle est
          décorative, ancrée derrière le texte, et ne porte aucune information.
          ------------------------------------------------------------------ */}
      <section className="relative overflow-hidden ruled-b bg-paper">
        <div aria-hidden className="grid-reg absolute inset-0" />

        <BranchPlate
          className={[
            'pointer-events-none absolute -right-16 -top-10 h-[130%] w-auto',
            'select-none text-sage opacity-[0.45]',
            'sm:-right-6 lg:right-12',
          ].join(' ')}
        />

        <div className="relative mx-auto grid max-w-[80rem] gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div className="max-w-2xl">
            <h1 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-[-0.045em] sm:text-4xl">
              {SITE.name}
            </h1>

            <span aria-hidden className="mt-4 block h-[2px] w-24 bg-rule" />

            <p className="label-reg mt-4 text-muted">{tSite('tagline')}</p>

            <p className="mt-8 max-w-xl text-lg text-ink">{t('intro')}</p>
          </div>

          {/* Chiffre d'inventaire, pas argument de vente : il dit la taille du
              registre, il ne prétend pas qu'il faut se dépêcher. */}
          <div className="rounded-card ruled bg-paper-raised p-5">
            <p className="data font-display text-2xl font-bold tracking-tight text-ink">
              {t('registerCount', { count: total })}
            </p>
            <p className="mt-3 text-xs text-muted">{t('registerNote')}</p>
          </div>
        </div>
      </section>

      {latest.length === 0 ? (
        <section className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
          <div className="rounded-card ruled bg-surface p-8">
            <p className="text-base text-ink">{t('emptyCatalogue')}</p>
            <p className="mt-1 text-xs text-muted">{t('emptyCatalogueHint')}</p>
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-[80rem] px-4 py-14 sm:px-6">
          <div className="flex items-baseline justify-between gap-4 border-b border-sand pb-3">
            <h2 className="text-xl">{t('newArrivals')}</h2>
            <Link
              href="/catalogue"
              className="label-reg text-muted underline underline-offset-4 hover:text-ink"
            >
              {t('seeAll')}
            </Link>
          </div>

          {/* Grille éditoriale asymétrique : la première pièce occupe deux
              colonnes et deux rangées. C'est ce qui distingue une vitrine
              d'une grille produit standard. */}
          <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
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
      <section className="ruled-t bg-paper-raised">
        <div className="mx-auto grid max-w-[80rem] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="border-b border-sand pb-3 text-xl">
              {t('shopByCategory')}
            </h2>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {categories.flatMap((root) =>
                (root.children.length > 0 ? root.children : [root]).map(
                  (category) => (
                    <li key={category.id}>
                      <Link
                        href={`/c/${root.children.length > 0 ? `${root.slug}/${category.slug}` : category.slug}`}
                        className="lift label-reg inline-flex min-h-[44px] items-center rounded-input border-[1.5px] border-rule bg-surface px-3 text-ink"
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
            <h2 className="border-b border-sand pb-3 text-xl">
              {t('shopByBrand')}
            </h2>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {brands.map((brand) => (
                <li key={brand.id}>
                  <Link
                    href={`/marque/${brand.slug}`}
                    className="lift label-reg inline-flex min-h-[44px] items-center rounded-input border-[1.5px] border-rule bg-surface px-3 text-ink"
                  >
                    {brand.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/marques"
              className="label-reg mt-5 inline-block text-muted underline underline-offset-4 hover:text-ink"
            >
              {tNav('brands')}
            </Link>
          </div>
        </div>
      </section>

      <section className="ruled-t">
        <div className="mx-auto max-w-[80rem] px-4 py-14 sm:px-6">
          <h2 className="border-b border-sand pb-3 text-xl">
            {t('howItWorks.title')}
          </h2>

          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex flex-col">
                <span
                  aria-hidden
                  className="data font-display text-3xl font-bold leading-none tracking-tight text-sand-strong"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span aria-hidden className="mt-3 block h-[1.5px] w-full bg-rule" />
                <h3 className="mt-4 text-lg">{step.title}</h3>
                <p className="mt-2 text-base text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  )
}
