'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { coudre } from '@/lib/design/couture'

/**
 * La surpiqûre qui borde la barre de navigation.
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

export function Surpiqure({
  /** Rayon de la barre, pour que la couture en épouse les arrondis. */
  rayon = 16,
  /** Retrait de la couture par rapport au bord de la barre. */
  retrait = 7,
}: {
  rayon?: number
  retrait?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [boite, setBoite] = useState({ w: LARGEUR_DE_REFERENCE, h: 64 })

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
  const h = Math.max(0, boite.h - retrait * 2)

  const contenu = coudre({
    largeur: w,
    hauteur: h,
    rayon: Math.max(2, rayon - retrait),
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
          <g
            transform={`translate(${retrait},${retrait})`}
            dangerouslySetInnerHTML={{ __html: contenu }}
          />
        </svg>
      )}
    </div>
  )
}
