/**
 * Les quatre icônes de la barre de navigation.
 *
 * ---------------------------------------------------------------------------
 * Dessinées ici, et pas installées
 * ---------------------------------------------------------------------------
 * Une bibliothèque d'icônes aurait suffi, et elle aurait coûté deux choses.
 *
 * Un poids d'abord : ces jeux embarquent des centaines de dessins pour en
 * servir quatre, et le découpage à la compilation ne rattrape jamais tout.
 *
 * Une allure ensuite, et c'est la vraie raison. Un jeu d'icônes a son propre
 * style — bouts arrondis, épaisseur, empattements du trait — qui n'est pas
 * celui de la charte. Quatre pictogrammes venus d'ailleurs, posés à côté d'une
 * signature composée et de filets réglés, se voient immédiatement : ils
 * appartiennent à un autre dessin.
 *
 * ---------------------------------------------------------------------------
 * La règle du trait
 * ---------------------------------------------------------------------------
 * Toutes suivent la même grammaire que les filets de la charte : trait de
 * 1,5 px, jamais d'aplat, bouts et angles arrondis, et la couleur prise dans
 * `currentColor` — donc héritée du texte voisin, y compris au survol et au
 * changement de thème. Aucune ne porte de couleur en propre.
 *
 * Le cadre est un carré de 24, et le dessin tient dans 20 : la marge d'un
 * pixel et demi de chaque côté est ce qui permet au trait de ne pas être rogné
 * quand le navigateur arrondit à la grille de pixels.
 *
 * ---------------------------------------------------------------------------
 * Muettes pour les lecteurs d'écran
 * ---------------------------------------------------------------------------
 * `aria-hidden` sur toutes, sans exception. Le nom accessible vient du lien ou
 * du bouton qui les porte, et il est traduit. Une icône qui porterait son
 * propre `title` le ferait annoncer EN PLUS du libellé du lien — « Favoris,
 * cœur, Favoris » — et ce doublon est un défaut courant.
 *
 * L'amendement au brief §11 autorise le végétal dessiné, en gravure et en
 * grand format, sur les pages éditoriales — et l'interdit dans un contrôle :
 * « pas de feuille dans un bouton, pas de pictogramme de recyclage ». Ces
 * quatre-là sont des outils, pas des symboles : une loupe, une silhouette, un
 * cœur, un cabas. Rien qui prétende dire quoi que ce soit sur l'écologie.
 */

interface ProprietesIcone {
  /** Taille du carré, en pixels. 24 par défaut. */
  taille?: number
  className?: string
}

/** Attributs communs : c'est eux qui font l'unité du jeu. */
function cadre(taille: number, className?: string) {
  return {
    width: taille,
    height: taille,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false as const,
    className,
  }
}

/** La loupe : un cercle et son manche, dans l'axe. */
export function IconeRecherche({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)}>
      <circle cx="11" cy="11" r="6.25" />
      <path d="M15.6 15.6 20 20" />
    </svg>
  )
}

/**
 * Le compte : une tête et des épaules.
 *
 * L'arc des épaules est ouvert vers le bas plutôt que fermé en demi-cercle :
 * un contour fermé donne un buste plein qui, à seize pixels, se lit comme une
 * goutte. L'arc ouvert garde la silhouette lisible à petite taille.
 */
export function IconeCompte({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)}>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  )
}

/**
 * Les favoris : un cœur, tracé en deux arcs et une pointe.
 *
 * Le cœur plutôt que l'étoile, et ce n'est pas indifférent : l'étoile dit
 * « noter », le cœur dit « garder ». Ici on garde une pièce qu'on aime, on ne
 * lui attribue pas une valeur.
 */
export function IconeFavoris({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)}>
      <path d="M12 20.2 4.6 12.9a4.6 4.6 0 0 1 0-6.6 4.8 4.8 0 0 1 6.7 0l.7.7.7-.7a4.8 4.8 0 0 1 6.7 0 4.6 4.6 0 0 1 0 6.6Z" />
    </svg>
  )
}

/**
 * Le panier : un CABAS, et pas un caddie de supermarché.
 *
 * Le choix se défend. Un caddie appartient au vocabulaire de la grande
 * distribution — on y empile des articles interchangeables. Cette boutique
 * vend des pièces uniques, une par référence, et le cabas est l'objet qu'on
 * emporte d'une boutique de quartier. Le dessin dit ce que la boutique est.
 */
export function IconePanier({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)}>
      <path d="M5.4 8h13.2l-1.1 11.2a1.5 1.5 0 0 1-1.5 1.3H8a1.5 1.5 0 0 1-1.5-1.3Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </svg>
  )
}
