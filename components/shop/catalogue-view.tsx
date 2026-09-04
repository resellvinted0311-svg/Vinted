import { getTranslations } from 'next-intl/server'
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
import { LoadMore } from './load-more'
import { ActiveFilterChips } from './active-filter-chips'
import { SearchBox } from './search-box'

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

  /*
    Libellés lisibles pour les pastilles de filtres actifs.

    Les catégories, marques et tailles portent DÉJÀ leur libellé traduit : il
    vient d'une jointure sur la table de traductions, ou c'est la valeur
    elle-même dans le cas d'une taille.

    Les vocabulaires fermés — couleur, matière, état, univers — non. Leur
    facette renvoie la valeur brute comme libellé, parce qu'ils n'ont pas de
    table de traductions : ils sont traduits dans les fichiers de messages. Les
    reprendre telles quelles affichait la pastille « ecru » là où le panneau de
    filtres, lui, écrit bien « Écru » — deux mots pour un même filtre, sur le
    même écran. Ils sont donc traduits ici aussi.
  */
  const labels: Record<string, string> = {}
  for (const group of [facets.categories, facets.brands, facets.sizes]) {
    for (const entry of group) labels[entry.value] = entry.label
  }

  for (const entry of facets.colors) labels[entry.value] = t(`colors.${entry.value}`)
  for (const entry of facets.materials) {
    labels[entry.value] = t(`materials.${entry.value}`)
  }
  for (const entry of facets.audiences) {
    labels[entry.value] = t(`audiences.${entry.value}`)
  }

  const tc = await getTranslations('condition')
  for (const entry of facets.conditions) {
    labels[entry.value] = tc(`${entry.value}.label`)
  }

  /**
   * Les filtres tels qu'on les AFFICHE en pastilles — pas ceux qu'on interroge.
   *
   * Les dimensions imposées par la page en sont retirées : sur /marque/levis,
   * « Levi's » n'est pas un filtre qu'on enlève, c'est la page. Une pastille
   * qui proposerait de le retirer mènerait hors de la page qui la porte.
   */
  const chipFilters: CatalogueFilters = { ...filters }
  for (const dimension of lockedDimensions) {
    const value = chipFilters[dimension]
    if (Array.isArray(value)) {
      ;(chipFilters[dimension] as string[]) = []
    }
  }

  /**
   * La chaîne de requête du lot suivant — pas une adresse complète.
   *
   * Le chemin est ajouté par le composant client, à partir de `basePath` qui
   * vient d'ici. L'action serveur, elle, ne reçoit et ne renvoie QUE des
   * chaînes de requête : aucun chemin ne transite par le navigateur, donc
   * aucun ne peut être détourné.
   *
   * -------------------------------------------------------------------------
   * Construite sur `filters`, et surtout PAS sur `chipFilters`
   * -------------------------------------------------------------------------
   * Les deux objets ne diffèrent que par les dimensions imposées, et c'est
   * précisément là que se jouait le défaut : la requête du lot suivant était
   * bâtie sur les filtres d'AFFICHAGE, donc amputée de la marque ou de la
   * catégorie qui définit la page.
   *
   * Sur /marque/levis, le premier lot montrait bien des Levi's ; « voir la
   * suite » servait ensuite des pièces du catalogue entier, ajoutées sous les
   * premières comme si elles en faisaient partie. Pire, le curseur avait été
   * calculé sur la liste FILTRÉE : appliqué à la liste complète, il sautait des
   * pièces et en répétait d'autres.
   *
   * Rien ne le signalait — la page se remplissait, les fiches étaient
   * valides — et il fallait reconnaître une marque étrangère au milieu du
   * second lot pour le voir. Un même objet servait deux besoins opposés :
   * montrer ce qui est retirable, et interroger ce qui est demandé.
   */
  const requeteSuivante = page.nextCursor
    ? filtersToSearchParams(filters, sort, page.nextCursor).toString()
    : null

  return (
    <div className="mx-auto max-w-[80rem] px-4 pb-24 pt-8 sm:px-6">
      {/* En-tête de registre : le titre, puis le décompte détaché sous un
          filet plein. Le nombre est une donnée d'inventaire, il est donc
          composé comme telle et non comme un argument. */}
      <header className="ruled-signature flex flex-col gap-3 pb-5">
        <h1 className="text-gradient text-2xl">{heading}</h1>
        {intro ? <p className="max-w-2xl text-base text-muted">{intro}</p> : null}
        <p className="data label-reg text-muted">
          {t('results', { count: page.totalCount })}
        </p>

        {/*
          La recherche vit ICI, et nulle part ailleurs sur le site.

          Elle était dans l'en-tête, donc sur toutes les pages : sur la
          vitrine, sur une fiche article, dans le tunnel de paiement. Un champ
          de recherche affiché là où l'on ne cherche pas encombre sans servir,
          et il ouvrait la vitrine sur un formulaire alors que la page a été
          écrite pour ouvrir sur une pièce.

          `key` force un nouveau champ quand la requête change : l'état du
          champ est local, et sans cela une navigation côté client laisserait
          l'ancienne requête affichée au-dessus des nouveaux résultats.
        */}
        <SearchBox
          key={filters.query ?? ''}
          valeurInitiale={filters.query ?? ''}
          className="w-full max-w-md"
        />
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
            <div className="mt-8 rounded-card ruled bg-surface p-8">
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
                {/*
                  DANS la grille, et non après elle : les fiches ajoutées
                  doivent être les sœurs des premières. Rendues dans un second
                  conteneur, elles recommenceraient les colonnes, et la
                  jointure se verrait dès que la dernière rangée est
                  incomplète. Le bouton, lui, occupe une rangée entière.
                */}
                {requeteSuivante ? (
                  <LoadMore
                    basePath={basePath}
                    requete={requeteSuivante}
                    locale={locale}
                    libelle={t('loadMore')}
                    libelleEnCours={t('loadingMore')}
                  />
                ) : null}
              </ArticleGrid>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
