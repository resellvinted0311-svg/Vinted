'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Révélation au défilement.
 *
 * Deux règles gouvernent ce composant, et elles expliquent sa forme.
 *
 * 1. Le contenu doit être visible SANS JavaScript. Le serveur rend donc
 *    l'élément à l'état final, et c'est le script qui, une fois monté, pose
 *    `data-reveal` pour l'escamoter avant de le révéler. Un composant qui
 *    partirait de `opacity: 0` en HTML laisserait une page blanche à quiconque
 *    n'exécute pas le script — moteurs d'indexation compris.
 *
 * 2. Le mouvement ne se rejoue pas. L'observateur se débranche à la première
 *    apparition : une section qui rejouerait son entrée à chaque remontée
 *    devient vite exaspérante sur une page longue.
 *
 * `prefers-reduced-motion` court-circuite tout : on ne pose jamais `data-reveal`,
 * l'élément reste simplement à sa place.
 */
export function Reveal({
  children,
  /** Décalage en millisecondes, pour cadencer une série d'éléments. */
  delay = 0,
  /** Sens d'arrivée. `up` par défaut ; `left`/`right` pour un contrepoint. */
  from = 'up',
  className,
}: {
  children: React.ReactNode
  delay?: number
  from?: 'up' | 'left' | 'right'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [armed, setArmed] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Sans observateur, on n'escamote rien. Le mode de défaillance de ce
    // composant est le pire qui soit pour une boutique — du contenu invisible
    // — donc il ne s'arme que s'il est certain de pouvoir se désarmer.
    if (typeof IntersectionObserver === 'undefined') return

    // Déjà dans le champ au chargement : on n'escamote pas, sinon le haut de
    // page clignoterait à chaque visite.
    const rect = node.getBoundingClientRect()
    if (rect.top < window.innerHeight * 0.9) {
      setArmed(true)
      setShown(true)
      return
    }

    setArmed(true)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setShown(true)
          observer.disconnect()
        }
      },
      // Se déclenche un peu avant l'entrée réelle : la révélation est alors
      // terminée quand l'élément arrive vraiment sous les yeux.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn('reveal', className)}
      data-reveal={armed ? (shown ? 'in' : 'out') : undefined}
      data-reveal-from={from}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
