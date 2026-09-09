'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { coudre } from '@/lib/design/couture'

/**
 * La surpiqûre.
 *
 * ---------------------------------------------------------------------------
 * PLUS AUCUNE PAGE NE L'APPELLE, et c'est volontaire
 * ---------------------------------------------------------------------------
 * Elle bordait le bas de la barre de navigation et les deux arêtes du bandeau
 * de réassurance. La boutique a demandé qu'on la retire des deux : posées l'une
 * sous l'autre, les trois lignes pointillées se lisaient comme un bruit dans
 * les cent premiers pixels de la vitrine.
 *
 * Le composant reste — le fil est un motif de la charte, pas un accident, et
 * ce qu'il documente ci-dessous (pourquoi il se redessine au lieu de s'étirer)
 * est le genre de raisonnement qu'on ne retrouve pas en le réécrivant. Le
 * remettre en service tient en une balise.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle se REDESSINE au lieu de s'étirer
 * ---------------------------------------------------------------------------
 * Un SVG fabriqué pour 900 px et posé dans une barre de 1 300 en
 * `preserveAspectRatio="none"` s'étire : les points des bords horizontaux
 * s'allongent d'un tiers, ceux des bords verticaux gardent leur taille, et les
 * arrondis deviennent des ellipses. Tout le travail sur le galbe du fil est
 * perdu, et le défaut est le plus visible là où on regarde le plus — les coins.
 *
 * La couture est donc RECALCULÉE à la largeur réelle. C'est quelques
 * millisecondes de calcul géométrique, à l'hydratation puis à chaque
 * redimensionnement, contre une déformation permanente.
 *
 * ---------------------------------------------------------------------------
 * Le premier rendu client est IDENTIQUE au rendu serveur
 * ---------------------------------------------------------------------------
 * Le serveur ne connaît pas la largeur de la fenêtre. Il dessine donc la
 * couture à une largeur de référence, et le navigateur ne la remplace qu'APRÈS
 * le montage, dans un effet. Mesurer pendant le rendu produirait un balisage
 * différent des deux côtés, et React rejetterait l'hydratation de toute la
 * barre — c'est-à-dire de la navigation.
 *
 * ---------------------------------------------------------------------------
 * Purement décorative
 * ---------------------------------------------------------------------------
 * `aria-hidden` : une couture ne s'annonce pas à un lecteur d'écran. Et sans
 * JavaScript, il reste la couture de référence — approximative en largeur, mais
 * présente. La barre ne dépend jamais d'elle pour être utilisable.
 */

/**
 * Largeur servie par le serveur, avant que le navigateur ne mesure.
 *
 * Volontairement proche de la barre sur un écran de bureau courant : si le
 * script ne s'exécute jamais, l'écart reste discret.
 */
const LARGEUR_DE_REFERENCE = 1100

/**
 * Hauteur servie par le serveur, avant que le navigateur ne mesure.
 *
 * Elle doit être ANNONCÉE par l'appelant quand elle s'écarte de celle d'une
 * barre de navigation. Le SVG est étiré à la boîte réelle tandis que son
 * `viewBox` reste celui du rendu serveur : une couture dessinée pour 64 px et
 * servie dans une bande de 9 en sortirait écrasée sept fois pendant le temps
 * qui sépare le premier affichage de l'hydratation. Bref, mais visible, et
 * exactement le genre de défaut qu'on ne voit jamais en développement — où
 * l'hydratation est immédiate.
 */
const HAUTEUR_DE_REFERENCE = 64

export function Surpiqure({
  /** Rayon de la barre, pour que la couture en épouse les arrondis. */
  rayon = 16,
  /** Retrait de la couture par rapport au bord de la barre. */
  retrait = 7,
  /** `cadre` fait le tour de l'élément ; `ligne` le traverse de bord à bord. */
  forme = 'cadre',
  /** La toile traversée. Voir `TEINTES` dans le module de couture. */
  ton = 'sombre',
  /**
   * Deux coutures voisines doivent avoir des graines DIFFÉRENTES.
   *
   * Le hasard est semé pour que serveur et navigateur produisent le même
   * balisage. La contrepartie : à dimensions égales, deux coutures de même
   * graine sont identiques au point près — deux lignes parallèles au haut et
   * au bas d'une bande se répondraient comme un calque, et l'œil le voit tout
   * de suite.
   */
  graine = 31,
  /**
   * Force de l'irrégularité, de 0 (machine parfaite) à 1 (franchement
   * artisanal).
   *
   * Elle se règle en fonction de CE À QUOI LA COUTURE SE COMPARE. Autour de la
   * barre de navigation, la piqûre longe un bord courbe : le regard suit la
   * courbe et l'écart passe inaperçu. Sur un bandeau de neuf pixels, le bord
   * droit passe à quatre pixels du fil, et le même écart se lit comme une
   * ondulation. Ce n'est pas la main de la couturière qui change, c'est ce
   * que l'œil a sous les yeux pour la juger.
   */
  desordre = 0.85,
  /** Hauteur attendue de la boîte, pour le rendu servi avant l'hydratation. */
  hauteurDeReference = HAUTEUR_DE_REFERENCE,
}: {
  rayon?: number
  retrait?: number
  forme?: 'cadre' | 'ligne'
  ton?: 'sombre' | 'clair'
  graine?: number
  desordre?: number
  hauteurDeReference?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [boite, setBoite] = useState({
    w: LARGEUR_DE_REFERENCE,
    h: hauteurDeReference,
  })

  // Les identifiants de dégradé doivent être uniques par instance : deux
  // coutures sur la même page partageraient sinon leurs `id`, et la seconde
  // repeindrait la première.
  const cle = `sp${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const mesurer = () => {
      const r = node.getBoundingClientRect()
      // Arrondi au pixel : sans cela, un redimensionnement continu relance le
      // calcul à chaque fraction de pixel pendant tout le glissement.
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      setBoite((avant) => (avant.w === w && avant.h === h ? avant : { w, h }))
    }

    mesurer()

    if (typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(node)
    return () => observateur.disconnect()
  }, [])

  const w = Math.max(0, boite.w - retrait * 2)
  // Une ligne garde toute la hauteur de sa boîte : le retrait sert à l'écarter
  // des bords GAUCHE et DROIT, pas à la comprimer verticalement — elle se pose
  // déjà à mi-hauteur, et lui retrancher deux fois le retrait la ferait
  // passer sous la hauteur minimale sur une bande fine, donc disparaître.
  const h = forme === 'ligne' ? boite.h : Math.max(0, boite.h - retrait * 2)

  const contenu = coudre({
    largeur: w,
    hauteur: h,
    rayon: Math.max(2, rayon - retrait),
    forme,
    ton,
    graine,
    desordre,
    cle,
  })

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0">
      {contenu === '' ? null : (
        <svg
          width={boite.w}
          height={boite.h}
          viewBox={`0 0 ${boite.w} ${boite.h}`}
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {/*
            La ligne n'est décalée QUE sur l'axe horizontal : sa hauteur est
            déjà celle de la boîte, et elle s'y place d'elle-même à mi-hauteur.
            La descendre encore du retrait la sortirait par le bas.
          */}
          <g
            transform={`translate(${retrait},${forme === 'ligne' ? 0 : retrait})`}
            dangerouslySetInnerHTML={{ __html: contenu }}
          />
        </svg>
      )}
    </div>
  )
}
