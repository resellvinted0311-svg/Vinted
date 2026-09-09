import { getTranslations } from 'next-intl/server'
import { listArticles, getFacets } from '@/lib/db/queries/articles'
import {
  filtersToSearchParams,
  type CatalogueFilters,
  type SortKey,
} from '@/lib/domain/catalogue'
import { ArticleCard, ArticleGrid, GRID_IMAGE_SIZES } from './article-card'
import { CatalogueFiltersPanel } from './catalogue-filters'
import { LoadMore } from './load-more'
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
  /**
   * Le titre et l'accroche sont portés PAR LA PAGE, pas par cette vue.
   *
   * Sert aux pages de rayon, où le nom de la catégorie est écrit dans le
   * bandeau qui ouvre la page. Sans cette bascule, le nom apparaîtrait deux
   * fois à quelques centimètres d'intervalle — et surtout la page aurait DEUX
   * `h1`, ce qu'aucun rendu ne signale et que le référencement lit mal.
   *
   * La contrepartie est une obligation pour l'appelant : s'il masque le titre
   * ici, il doit en poser un ailleurs. Un test de bout en bout compte les `h1`
   * de la page de rayon pour que l'oubli ne passe pas.
   *
   * Le décompte de pièces, la recherche et les filtres restent en place : ils
   * appartiennent à l'outil, pas à l'en-tête éditorial.
   */
  hideHeading = false,
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
  hideHeading?: boolean
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

  for (const entry of facets.colors)
    labels[entry.value] = t(`colors.${entry.value}`)
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
   * Combien de filtres sont posés, pour le pastillage du bouton.
   *
   * ---------------------------------------------------------------------------
   * Pourquoi ce compte existe
   * ---------------------------------------------------------------------------
   * Les filtres ont quitté la page pour un volet fermé. Ce qui était visible en
   * permanence — huit groupes, les cases cochées sous les yeux — ne l'est plus,
   * et un filtre qu'on a oublié d'enlever explique une grille presque vide sans
   * qu'on comprenne pourquoi. C'est le défaut classique du filtrage escamoté :
   * la boutique semble n'avoir que trois pièces.
   *
   * Le compte le dit depuis le bouton, sans l'ouvrir. Il double les pastilles
   * retirables qui restent, elles, dans la page.
   *
   * Il se calcule sur `chipFilters` et non sur `filters` : la catégorie imposée
   * par `/c/hauts/pulls-sweats` n'est pas un filtre que la personne a posé,
   * c'est la page où elle se trouve. La compter afficherait « 1 » sur un rayon
   * qu'on vient d'ouvrir sans rien demander.
   */
  const compteFiltresActifs =
    Object.values(chipFilters).reduce(
      (total, valeur) => total + (Array.isArray(valeur) ? valeur.length : 0),
      0,
    ) +
    (chipFilters.minPriceCents !== null ? 1 : 0) +
    (chipFilters.maxPriceCents !== null ? 1 : 0)

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
    <div className="mx-auto max-w-[var(--colonne)] px-4 pb-24 pt-8 sm:px-6">
      {/* En-tête de registre : le titre, puis le décompte détaché sous un
          filet plein. Le nombre est une donnée d'inventaire, il est donc
          composé comme telle et non comme un argument. */}
      <header className="ruled-signature flex flex-col gap-3 pb-5">
        {hideHeading ? null : (
          <h1 className="text-gradient text-2xl">{heading}</h1>
        )}
        {intro && !hideHeading ? (
          <p className="max-w-2xl text-base text-muted">{intro}</p>
        ) : null}
        {/*
          Le décompte est une RÉGION VIVANTE, et c'est ce qui rend le filtrage
          perceptible sans les yeux.

          Filtrer passe par un `router.push` sur le MÊME chemin : l'annonceur
          de route de Next se déclenche sur le changement de chemin, il ne dit
          donc rien ici, et le titre du document ne bouge pas non plus.
          « Voir la suite » n'change même pas l'adresse. Sans cette région, on
          cochait un filtre et il ne se passait rien d'audible — la grille
          changeait en silence.

          `polite` et non `assertive` : l'annonce attend une pause, elle ne
          coupe pas la lecture en cours. Le texte entier est réannoncé
          (`atomic`) parce que « 12 » seul ne veut rien dire.
        */}
        <p
          aria-live="polite"
          aria-atomic="true"
          className="data label-reg text-muted"
        >
          {t('results', { count: page.totalCount })}
        </p>

        {/*
          LA RECHERCHE EST REMONTÉE DANS LA BARRE, derrière la loupe.

          Elle a fait l'aller-retour, et les deux mouvements avaient leur
          raison. Elle vivait d'abord dans l'en-tête, donc sur toutes les pages
          — vitrine, fiche article, tunnel de paiement — où un champ de
          recherche encombre sans servir. Elle est descendue ici, auprès des
          résultats qu'elle filtre.

          Elle remonte parce que la barre a désormais une loupe, et que le
          champ ne s'y déploie QUE si on le demande : l'encombrement qui avait
          motivé la descente n'existe plus.

          Elle ne peut pas vivre aux deux endroits. `SearchBox` est une
          combobox, avec un intitulé et une liste annoncée ; deux exemplaires
          dans un même document, c'est deux commandes homonymes pour un lecteur
          d'écran, et sa propre documentation l'interdit.

          Ce que cette page perd : le champ ne se rouvre plus prérempli avec la
          requête en cours. Ce qui le remplace est juste en dessous — la
          requête apparaît en pastille retirable parmi les filtres actifs, avec
          les guillemets qui la citent. On la voit, on l'enlève d'un clic ; on
          la corrige en rouvrant la loupe.
        */}
      </header>

      {/*
        =====================================================================
        LES FILTRES NE SONT PLUS UNE COLONNE, MAIS UN VOLET
        =====================================================================
        Ils occupaient seize rem à gauche, en permanence, sur toute page de
        catalogue. C'est un quart de la largeur donné à un outil dont on se
        sert par à-coups, pendant que les pièces — le propos de la page — se
        serrent dans ce qui reste.

        Un seul bouton les remplace, posé en bas de l'écran et qui y reste
        pendant tout le défilement. C'est le geste juste : on filtre APRÈS
        avoir regardé, pas avant, et le bouton est là au moment où l'envie
        vient plutôt qu'en haut d'une page qu'on a quittée depuis longtemps.

        ---------------------------------------------------------------------
        Sans JavaScript, et ce n'est pas une clause de style
        ---------------------------------------------------------------------
        La boutique fonctionne sans script — c'est une garantie tenue par des
        tests, et elle a déjà rattrapé une régression ici même. Un volet ouvert
        par un `onClick` la romprait : sans script, le bouton ne ferait rien et
        les filtres deviendraient inatteignables. Pas dégradés : INATTEIGNABLES.

        Le mécanisme est donc une case à cocher masquée, dont l'étiquette est
        le bouton visible. Cocher, c'est ouvrir. C'est exactement le procédé
        qui repliait déjà le panneau sur téléphone ; il est ici généralisé à
        toutes les largeurs et redessiné en volet.

        `peer` ne porte que sur les frères SUIVANTS : la case doit rester
        devant tout ce qu'elle commande, et les trois éléments qu'elle pilote —
        le bouton, le voile, le volet — sont ses frères immédiats.
      */}
      {/*
        La case est en position FIXE, et ce détail vaut un défaut réel.

        Elle était en `sr-only`, la recette habituelle pour cacher un contrôle
        sans le retirer du clavier. Or `sr-only` positionne en ABSOLU : la case
        reste donc à sa place dans la page, tout en haut du catalogue. Cliquer
        son étiquette lui donne le focus, et le navigateur fait alors ce qu'il
        doit faire avec un élément focalisé hors du champ — il le ramène dans
        le champ, c'est-à-dire qu'il remonte la page.

        Mesuré sur téléphone : défilement à 400, ouverture du volet, défilement
        à 0. Autrement dit, toute personne qui ouvre les filtres après avoir
        parcouru la grille était renvoyée au début, et retrouvait la page au
        sommet en refermant. Le geste le plus courant de l'écran, cassé par la
        façon dont on cache une case à cocher.

        En position fixe, la case est toujours « dans le champ » : il n'y a
        plus rien à ramener, et le défilement ne bouge pas. Un pixel, sans
        opacité, toujours focalisable — le clavier y accède comme avant, et
        l'étiquette porte la marque de focus à sa place.
      */}
      <input
        type="checkbox"
        id="nd-filtres"
        className="peer fixed left-0 top-0 h-px w-px opacity-0"
      />

      {/*
        Le bouton, fixé au bas de la fenêtre.

        `fixed` et non `sticky` : il ne doit appartenir à aucun bloc de la
        page, sans quoi il s'arrêterait à la fin de la grille — c'est-à-dire
        au moment précis où il sert encore.

        `pb-[env(safe-area-inset-bottom)]` tient compte de la barre système des
        téléphones sans bouton d'accueil : sans elle, le bouton se retrouve
        sous la barre de geste, à moitié cliquable.

        Il s'efface quand le volet est ouvert : il ferait sinon un doublon
        posé par-dessus le volet, qui porte déjà son propre bouton de sortie.
      */}
      <label
        htmlFor="nd-filtres"
        /*
          Un repère de test PROPRE, parce que le sélecteur évident est devenu
          ambigu : quatre étiquettes pointent maintenant vers la même case —
          ce bouton, le voile, la croix et « Voir les résultats ». C'est
          voulu, toutes commandent bien la même bascule, mais un test qui
          cherche « l'étiquette » n'a plus de réponse unique.
        */
        data-testid="ouvrir-filtres"
        /*
          La marque de focus est portée par L'ÉTIQUETTE, puisque la case qui
          reçoit réellement le focus est invisible. Sans cette règle, une
          personne au clavier tabule jusqu'aux filtres sans aucun retour à
          l'écran : le focus existe, il ne se voit pas.
        */
        className="bouton-filtres fixed bottom-5 left-1/2 z-40 flex min-h-[48px] -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full px-6 text-base font-semibold peer-checked:hidden peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]"
      >
        {t('filterAndSort')}
        {compteFiltresActifs > 0 ? (
          <span className="data rounded-full bg-ink-inverse px-2 py-0.5 text-xs text-stamp">
            {compteFiltresActifs}
          </span>
        ) : null}
      </label>

      {/*
        Le voile. Il assombrit la page derrière le volet, et il FERME au clic.

        C'est une étiquette, pas un bouton : cliquer dessus décoche la même
        case. Sans lui, la seule sortie serait la croix — et cliquer à côté
        pour fermer est le geste que tout le monde tente en premier.

        `aria-hidden` parce qu'il double une commande déjà annoncée : un
        lecteur d'écran a le bouton de fermeture du volet, il n'a rien à faire
        d'une seconde étiquette sans texte.
      */}
      <label
        htmlFor="nd-filtres"
        aria-hidden
        className="invisible fixed inset-0 z-40 bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] opacity-0 transition-opacity duration-200 peer-checked:visible peer-checked:opacity-100 motion-reduce:transition-none"
      />

      {/*
        Le volet, à droite.

        `invisible` et non `hidden` : `hidden` couperait la transition, mais
        surtout un volet fermé qui resterait seulement décalé garderait ses
        champs dans l'ordre de tabulation et dans l'arbre d'accessibilité. On
        se retrouverait à parcourir au clavier huit groupes de filtres
        invisibles, posés hors de l'écran. `invisible` les en retire.
      */}
      <aside
        data-testid="volet-filtres"
        className="invisible fixed inset-y-0 right-0 z-50 w-full max-w-[24rem] translate-x-full overflow-y-auto overscroll-contain bg-paper [scroll-behavior:auto] shadow-[-8px_0_32px_-24px_color-mix(in_oklab,var(--ink)_70%,transparent)] transition-transform duration-300 ease-out peer-checked:visible peer-checked:translate-x-0 motion-reduce:transition-none"
        aria-label={t('filtersHeading')}
      >
        {/*
          UN SEUL conteneur de défilement, et c'est le volet lui-même.

          Il y en avait deux imbriqués : le volet fixe, et une zone
          `overflow-y-auto` à l'intérieur qui portait les facettes. C'était le
          gabarit habituel — en-tête figé, corps qui défile, pied figé — et il
          coûtait plus qu'il ne rapportait ici. Un conteneur qui défile,
          imbriqué dans un élément fixe, est un cas que les navigateurs
          traitent mal quand il s'agit d'amener un élément dans le champ :
          `scrollIntoView` visait le mauvais parent et la case restait hors
          d'atteinte, à neuf cents pixels du haut.

          Le volet défile donc d'une seule pièce, et son en-tête reste
          accroché en haut par `sticky` — même effet, une couche de moins.
        */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-sand bg-paper px-5 py-4">
          <h2 className="type-section font-display text-xl font-bold uppercase text-ink">
            {t('filtersHeading')}
          </h2>
          {/*
            Les DEUX étiquettes du volet portent la marque de focus, comme
            celle qui l'ouvre.

            La case est un pixel transparent : son anneau ne se voit pas, et
            c'est l'étiquette qui l'affiche à sa place. Seul le bouton
            d'ouverture le faisait — or il disparaît dès que le volet s'ouvre.
            Une personne au clavier tabulait donc dans un volet ouvert sans
            plus rien voir du tout de sa position.
          */}
          <label
            htmlFor="nd-filtres"
            className={`flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-input text-sm text-muted hover:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]`}
          >
            <span className="sr-only">{t('closeFilters')}</span>
            <span aria-hidden className="text-2xl leading-none">
              ×
            </span>
          </label>
        </div>

        {/*
          Le panneau défile DANS le volet, et le volet ne défile pas lui-même.
          Huit groupes de facettes dépassent la hauteur d'un téléphone ; sans
          cette zone de défilement propre, la fin de la liste serait hors
          d'atteinte.
        */}
        <div className="px-5 py-5">
          <CatalogueFiltersPanel
            action={formAction}
            facets={facets}
            filters={filters}
            sort={sort}
            locale={locale}
            // Les dimensions que la page impose n'ont pas de groupe : leurs
            // cases seraient sans effet, la page réécrivant le filtre.
            lockedDimensions={lockedDimensions}
          />
        </div>

        {/*
          Le pied du volet.

          Sans JavaScript, chaque changement recharge la page et referme le
          volet : ce bouton est alors la sortie normale. Avec JavaScript, les
          résultats se mettent à jour derrière le volet, et il sert à revenir
          les voir. Dans les deux cas, il dit la même chose.
        */}
        <div className="sticky bottom-0 border-t border-sand bg-paper px-5 py-4">
          <label
            htmlFor="nd-filtres"
            className={`bouton-filtres flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-full text-base font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]`}
          >
            {t('seeResults')}
          </label>
        </div>
      </aside>

      {/*
        La zone de résultats RÉSERVE sa hauteur.

        Deux défauts, un seul remède.

        Le premier se mesure : filtrer raccourcit la grille, et pendant le
        court instant où la nouvelle liste remplace l'ancienne, le document
        devient plus court que la position de défilement. Le navigateur rabat
        alors le défilement sur le nouveau maximum — et quand la page
        retrouve sa longueur, personne ne le remet où il était. Relevé sur
        téléphone : défilement à 400 avant le filtre, 7 après. La personne
        est renvoyée en haut sans que rien n'ait été demandé.

        Le second se voit : une grille qui rend deux pièces sur une page
        blanche laisse un grand vide sous elle, et la boutique paraît fermée.

        Une hauteur minimale règle les deux : le document ne peut plus
        s'effondrer sous le défilement, et le bas de page reste à sa place au
        lieu de remonter à mi-écran.
      */}
      <div className="mt-6 min-h-[70svh]">
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
  )
}
