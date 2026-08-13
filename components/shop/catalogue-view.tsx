import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { listArticles, getFacets } from '@/lib/db/queries/articles'
import {
  filtersToSearchParams,
  type CatalogueFilters,
  type SortKey,
} from '@/lib/domain/catalogue'
import {
  ArticleCard,
  ArticleGrid,
  GRID_IMAGE_SIZES,
} from './article-card'
import { CatalogueFiltersPanel } from './catalogue-filters'
import { ActiveFilterChips } from './active-filter-chips'

/**
 * Vue catalogue partagée.
 *
 * Sert /catalogue, /c/[...slug] et /marque/[brand] : les trois affichent la
 * même grille, seuls le chemin de base et les filtres imposés changent.
 * Factoriser ici évite trois implémentations qui divergeraient.
 */
export async function CatalogueView({
  basePath,
  filters,
  sort,
  cursor,
  locale,
  /** Filtres imposés par la page (catégorie, marque) : non retirables. */
  lockedDimensions = [],
  heading,
  intro,
}: {
  /**
   * Chemin SANS préfixe de langue, ex. `/catalogue`.
   *
   * Le composant Link de next-intl ajoute lui-même la langue ; un
   * `<form action>` en HTML pur, lui, exige le chemin complet. Les deux
   * formes sont donc dérivées ici plutôt que passées par l'appelant, sous
   * peine de produire des liens en `/fr/fr/catalogue`.
   */
  basePath: string
  filters: CatalogueFilters
  sort: SortKey
  cursor: string | null
  locale: string
  lockedDimensions?: (keyof CatalogueFilters)[]
  heading: string
  intro?: string | null
}) {
  const t = await getTranslations('catalogue')
  const formAction = `/${locale}${basePath}`

  const [page, facets] = await Promise.all([
    listArticles({ filters, sort, cursor, locale }),
    getFacets(filters, locale),
  ])

  // Libellés lisibles pour les pastilles de filtres actifs : les facettes les
  // portent déjà, inutile de réinterroger la base.
  const labels: Record<string, string> = {}
  for (const group of [
    facets.categories,
    facets.brands,
    facets.sizes,
    facets.colors,
    facets.materials,
  ]) {
    for (const entry of group) labels[entry.value] = entry.label
  }
  const tc = await getTranslations('condition')
  for (const entry of facets.conditions) {
    labels[entry.value] = tc(`${entry.value}.label`)
  }

  // Les dimensions imposées par la page sont retirées des pastilles : sur
  // /marque/levis, « Levi's » n'est pas un filtre qu'on enlève, c'est la page.
  const chipFilters: CatalogueFilters = { ...filters }
  for (const dimension of lockedDimensions) {
    const value = chipFilters[dimension]
    if (Array.isArray(value)) {
      ;(chipFilters[dimension] as string[]) = []
    }
  }

  const nextHref = page.nextCursor
    ? `${basePath}?${filtersToSearchParams(chipFilters, sort, page.nextCursor).toString()}`
    : null

  return (
    <div className="mx-auto max-w-[80rem] px-4 py-8 sm:px-6">
      {/* En-tête de registre : le titre, puis le décompte détaché sous un
          filet plein. Le nombre est une donnée d'inventaire, il est donc
          composé comme telle et non comme un argument. */}
      <header className="flex flex-col gap-3 ruled-b pb-4">
        <h1 className="text-2xl">{heading}</h1>
        {intro ? <p className="max-w-2xl text-base text-muted">{intro}</p> : null}
        <p className="data label-reg text-muted">
          {t('results', { count: page.totalCount })}
        </p>
      </header>

      <div className="mt-6 lg:grid lg:grid-cols-[16rem_1fr] lg:gap-10">
        {/*
          Un seul panneau dans le DOM, présenté différemment selon la largeur.
          Le rendre deux fois (une version mobile, une version bureau)
          dupliquerait tous les champs du formulaire : deux cases nommées
          « marque » pour la même marque, annoncées deux fois aux lecteurs
          d'écran.

          <details> replié par défaut sur mobile ; au-delà de 1024 px, une
          règle CSS masque le résumé et force l'affichage du contenu, sans
          qu'aucun script n'intervienne (voir data-filters dans globals.css).
        */}
        <div className="lg:contents">
          {/*
            Bascule sans JavaScript.

            <details> aurait été plus élégant sémantiquement, mais son contenu
            replié est masqué par un slot interne du navigateur : on peut le
            cacher en CSS, pas le révéler. Impossible donc de le forcer ouvert
            sur grand écran. La case reste accessible au clavier (sr-only ne
            la retire pas de l'ordre de tabulation) et l'étiquette lui sert
            d'affordance visible.
          */}
          <input
            type="checkbox"
            id="nd-filtres"
            className="peer sr-only"
          />
          <label
            htmlFor="nd-filtres"
            className="label-reg flex min-h-[44px] cursor-pointer items-center justify-between ruled-b text-ink lg:hidden"
          >
            {t('filtersHeading')}
          </label>

          <aside className="hidden py-4 peer-checked:block lg:block lg:py-0">
            <h2 className="sr-only">{t('filtersHeading')}</h2>
            <CatalogueFiltersPanel
              action={formAction}
              facets={facets}
              filters={filters}
              sort={sort}
              locale={locale}
            />
          </aside>
        </div>

        <div className="mt-6 lg:mt-0">
          <ActiveFilterChips
            basePath={basePath}
            filters={chipFilters}
            sort={sort}
            locale={locale}
            labels={labels}
          />

          {page.items.length === 0 ? (
            <div className="grid-reg mt-8 rounded-card ruled bg-surface p-8">
              <p className="text-base text-ink">{t('noResults')}</p>
              <p className="mt-1 text-xs text-muted">{t('noResultsHint')}</p>
            </div>
          ) : (
            <div className="mt-6">
              <ArticleGrid>
                {page.items.map((article, index) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    locale={locale}
                    sizes={GRID_IMAGE_SIZES}
                    // Les quatre premières vignettes portent le LCP.
                    priority={index < 4}
                  />
                ))}
              </ArticleGrid>

              {nextHref ? (
                <div className="mt-10 flex justify-center">
                  <Link
                    href={nextHref}
                    rel="next"
                    className="lift label-reg inline-flex min-h-[44px] items-center rounded-input border-[1.5px] border-rule bg-surface px-6 text-ink"
                  >
                    {t('loadMore')}
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
