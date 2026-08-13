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

/**
 * Squelette de vignette catalogue, aux proportions exactes de la fiche : même
 * contour plein, même filet sous la photo, mêmes trois lignes de texte. Une
 * réserve qui n'a pas la forme de son contenu produit un saut de mise en page
 * au chargement, ce que le squelette est précisément censé éviter.
 */
export function ArticleCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card ruled bg-paper-raised">
      <Skeleton ratio="portrait" className="ruled-b w-full rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    </div>
  )
}
