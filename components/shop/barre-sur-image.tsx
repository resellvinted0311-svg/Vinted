'use client'

import { useEffect, useRef } from 'react'

/**
 * Le repère qui dit à la barre quand elle a quitté la photographie.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'il fait, et surtout ce qu'il NE fait pas
 * ---------------------------------------------------------------------------
 * La barre posée sur le bandeau — sans fond, à l'encre blanche — est obtenue
 * entièrement en CSS, sous une requête `(scripting: enabled)`. Ce composant
 * n'en est pas responsable et ne la déclenche pas : script coupé, la barre
 * reste blanche et lisible, et rien de ce fichier ne s'exécute.
 *
 * Il ne répond qu'à la seule question que le CSS ne sait pas poser : « le bas
 * de l'image est-il passé au-dessus de la barre ? » La réponse s'écrit en un
 * attribut sur la racine du document, `data-barre-descendue`, que la feuille
 * de style lit pour rendre la barre blanche.
 *
 * ---------------------------------------------------------------------------
 * Un observateur d'intersection, pas un écouteur de défilement
 * ---------------------------------------------------------------------------
 * Un `scroll` se déclenche des dizaines de fois par seconde, sur le fil
 * principal, et chaque appel qui lit une position force un recalcul de mise en
 * page. C'est le motif classique du défilement qui saccade sur téléphone.
 * L'observateur, lui, ne rend la main qu'au franchissement de la ligne, et le
 * navigateur fait le calcul hors du fil principal.
 *
 * La ligne de franchissement est le BAS DE LA BARRE, obtenu en rentrant le
 * cadre d'observation de la hauteur de celle-ci. Le repère est haut d'un pixel
 * et collé au bas du bandeau : tant qu'il est sous la barre, l'image porte
 * encore la barre ; dès qu'il passe dessus, elle ne la porte plus.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la hauteur est MESURÉE et non lue dans la constante
 * ---------------------------------------------------------------------------
 * `--nav-h` vaut la hauteur de la barre à partir de 768 px, et c'est un
 * plancher : une traduction plus longue peut la faire grandir. En lisant la
 * constante, la bascule se produirait quelques pixels trop tôt ou trop tard —
 * un défaut minuscule, invisible en français, visible en allemand. On mesure
 * donc la barre rendue, et on remesure quand elle change de taille : c'est le
 * rôle de l'observateur de redimensionnement, qui couvre aussi bien la
 * rotation d'un téléphone que l'arrivée tardive d'une police.
 */
export function BarreSurImage() {
  const repere = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cible = repere.current
    if (!cible) return

    const racine = document.documentElement
    /*
      `header.nav-plein`, et pas `header` tout court.

      Une page de rayon porte DEUX `header` : la barre de navigation, et
      l'en-tête du bloc de résultats qui annonce le nombre d'articles. Le
      sélecteur nu prend le premier du document — la barre, aujourd'hui — mais
      il suffirait qu'un jour la barre descende d'un cran dans la mise en page
      pour que la ligne de bascule se cale sur la hauteur d'un titre de
      section. Le défaut a d'ailleurs été révélé par un test qui, lui,
      trébuchait franchement sur l'ambiguïté.
    */
    const barre = document.querySelector('header.nav-plein')

    let observateur: IntersectionObserver | null = null

    const poser = () => {
      observateur?.disconnect()

      const hauteur = barre
        ? Math.round(barre.getBoundingClientRect().height)
        : 0

      observateur = new IntersectionObserver(
        (entrees) => {
          // La DERNIÈRE entrée, jamais la première : un observateur peut
          // livrer plusieurs franchissements d'un coup — un défilement rapide,
          // un onglet qu'on revient regarder — et la première dit alors l'état
          // le plus ancien. Lire celle-là ferait clignoter la barre.
          const derniere = entrees[entrees.length - 1]
          if (!derniere) return

          // `toggleAttribute` plutôt que deux branches : l'attribut est un
          // booléen, et l'écrire dans les deux sens au même endroit évite le
          // cas où l'une des branches oublie de nettoyer.
          racine.toggleAttribute(
            'data-barre-descendue',
            !derniere.isIntersecting,
          )
        },
        { rootMargin: `-${hauteur}px 0px 0px 0px`, threshold: 0 },
      )

      observateur.observe(cible)
    }

    poser()

    // La hauteur de la barre change avec la largeur de la fenêtre — deux
    // registres sous 768 px, trois sous 480. Sans cette reprise, la ligne de
    // franchissement resterait calée sur la première mesure et la barre
    // basculerait au mauvais moment après une rotation d'écran.
    const redimension = new ResizeObserver(poser)
    if (barre) redimension.observe(barre)

    return () => {
      redimension.disconnect()
      observateur?.disconnect()
      // Le nettoyage n'est pas une politesse : sans lui, quitter une page à
      // bandeau alors qu'on l'avait dépassée laisserait l'attribut posé, et la
      // page suivante hériterait d'un état qui ne la concerne pas.
      racine.removeAttribute('data-barre-descendue')
    }
  }, [])

  return (
    <div
      ref={repere}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
    />
  )
}
