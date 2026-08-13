'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Dérive au pointeur.
 *
 * Le contenu suit très légèrement la souris à l'intérieur de son cadre. C'est
 * la seule interaction du site qui répond au geste plutôt qu'au clic, et elle
 * est réservée au visuel principal de l'accueil : généralisée, elle
 * deviendrait du bruit.
 *
 * Trois précautions :
 *
 *  - la position est écrite dans une variable CSS et appliquée par un
 *    `transform`, donc composée par le GPU, sans recalcul de mise en page ;
 *  - l'écriture est cadencée par `requestAnimationFrame` : `pointermove` peut
 *    émettre plus vite que l'écran ne rafraîchit ;
 *  - l'écoute n'est branchée que sur les pointeurs fins qui survolent
 *    réellement. Au doigt, il n'y a pas de survol, et l'effet n'existe pas.
 */
export function PointerDrift({
  children,
  /** Amplitude maximale, en pixels. Volontairement faible. */
  strength = 14,
  className,
}: {
  children: React.ReactNode
  strength?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!canHover.matches || reduced.matches) return

    let frame = 0
    let x = 0
    let y = 0

    const apply = (): void => {
      frame = 0
      node.style.setProperty('--drift-x', `${x.toFixed(2)}px`)
      node.style.setProperty('--drift-y', `${y.toFixed(2)}px`)
    }

    const onMove = (event: PointerEvent): void => {
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      // Position relative au centre, ramenée dans [-1, 1].
      x = ((event.clientX - rect.left) / rect.width - 0.5) * 2 * strength
      y = ((event.clientY - rect.top) / rect.height - 0.5) * 2 * strength

      if (frame === 0) frame = requestAnimationFrame(apply)
    }

    const onLeave = (): void => {
      x = 0
      y = 0
      if (frame === 0) frame = requestAnimationFrame(apply)
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)

    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [strength])

  return (
    <div ref={ref} className={cn('drift', className)}>
      {children}
    </div>
  )
}
