'use client'

import { useEffect, useRef } from 'react'

/**
 * La vidéo du grand visuel d'arrivée.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ces quatre attributs, et pas trois
 * ---------------------------------------------------------------------------
 * `muted` + `playsInline` + `autoPlay` sont la condition POSÉE PAR LES
 * NAVIGATEURS pour qu'une lecture démarre seule : une vidéo sonore est refusée,
 * et sans `playsinline` iOS l'ouvre en plein écran par-dessus la boutique. En
 * retirer un ne produit pas d'erreur — la vidéo reste simplement figée sur sa
 * première image, ce qui ressemble à une photo mal cadrée.
 *
 * `loop` parce qu'un fond de vitrine qui s'arrête sur une image quelconque au
 * bout de dix secondes est pire que pas de vidéo du tout.
 *
 * ---------------------------------------------------------------------------
 * `prefers-reduced-motion` est respecté ICI, en JavaScript
 * ---------------------------------------------------------------------------
 * Aucune règle CSS n'arrête une vidéo. Le réglage système existe pour des
 * personnes que le mouvement rend malades — vertiges, migraines, troubles
 * vestibulaires — et une boucle plein écran est précisément ce qu'il vise.
 *
 * On met donc en pause après le montage, et on revient sur l'affiche. La vidéo
 * garde `autoPlay` dans le HTML : la mise en pause est immédiate, alors qu'un
 * démarrage conditionnel priverait de mouvement tous ceux qui n'exécutent pas
 * le script.
 *
 * ---------------------------------------------------------------------------
 * L'affiche n'est pas un détail
 * ---------------------------------------------------------------------------
 * `poster` est ce qui s'affiche pendant le chargement, en cas d'échec, et sous
 * mouvement réduit. Sans elle, le cadre est NOIR le temps du téléchargement —
 * plusieurs secondes en connexion lente, sur la première chose que voit la
 * visiteuse.
 */
export function HeroVideo({
  src,
  poster,
  className,
}: {
  src: string
  /** Image d'attente, dérivée de la vidéo par l'hébergeur. */
  poster: string
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const requete = window.matchMedia('(prefers-reduced-motion: reduce)')

    const appliquer = () => {
      if (requete.matches) {
        node.pause()
        // Retour à la première image : une pause au hasard du chargement
        // laisserait un arrêt sur image flou ou à contretemps.
        node.currentTime = 0
      } else {
        // `play()` renvoie une promesse qui ÉCHOUE si le navigateur refuse la
        // lecture automatique. Non attrapée, elle remonte en erreur non gérée
        // et part chez Sentry à chaque visite, pour un refus parfaitement
        // normal — l'affiche reste alors visible, ce qui est le bon repli.
        void node.play().catch(() => {})
      }
    }

    appliquer()

    // Le réglage peut changer pendant la visite : on suit.
    requete.addEventListener('change', appliquer)
    return () => requete.removeEventListener('change', appliquer)
  }, [])

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      // Décoratif : le sens de la page est porté par le titre en HTML, pas par
      // le fond. Annoncer « vidéo » à un lecteur d'écran n'apprendrait rien et
      // ajouterait un obstacle avant le contenu.
      aria-hidden
      tabIndex={-1}
      className={className}
    />
  )
}
