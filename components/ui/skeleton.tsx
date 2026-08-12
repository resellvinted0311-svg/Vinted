import * as React from 'react'
import { cn } from '@/lib/utils/cn'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Le bloc doit réserver exactement la place du contenu final (CLS < 0,1). */
  ratio?: 'square' | 'portrait' | 'auto'
}

/**
 * Réserve d'espace pendant le chargement.
 *
 * Pulsation très discrète, désactivée par prefers-reduced-motion via la règle
 * globale. Pas d'effet de balayage brillant : c'est décoratif et ça fatigue.
 */
export function Skeleton({
  className,
  ratio = 'auto',
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-input bg-sand',
        ratio === 'square' && 'aspect-square',
        ratio === 'portrait' && 'aspect-[3/4]',
        className,
      )}
      {...props}
    />
  )
}

/** Squelette de vignette catalogue, aux proportions exactes de la carte. */
export function ArticleCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton ratio="portrait" className="w-full rounded-card" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  )
}
