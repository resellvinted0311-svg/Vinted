'use client'

import { useTransition } from 'react'
import { cn } from '@/lib/utils/cn'
import { useFavorites } from './favorites-provider'

/**
 * Bouton favori.
 *
 * Un cœur plein ou vide, sans compteur ni animation d'attention. La zone de
 * clic fait 44 px même si l'icône est petite, et l'état est annoncé par
 * `aria-pressed` plutôt que par la seule couleur.
 */
export function FavoriteButton({
  articleId,
  label,
  labelRemove,
  size = 'md',
  className,
}: {
  articleId: string
  label: string
  labelRemove: string
  size?: 'md' | 'lg'
  className?: string
}) {
  const { ids, toggle } = useFavorites()
  const [isPending, startTransition] = useTransition()
  const isFavorite = ids.has(articleId)

  return (
    <button
      type="button"
      aria-pressed={isFavorite}
      aria-label={isFavorite ? labelRemove : label}
      title={isFavorite ? labelRemove : label}
      disabled={isPending}
      onClick={(event) => {
        // La vignette entière est cliquable via un pseudo-élément : sans
        // cela, mettre en favori ouvrirait aussi la fiche article.
        event.preventDefault()
        event.stopPropagation()
        startTransition(async () => {
          await toggle(articleId)
        })
      }}
      className={cn(
        'relative z-10 inline-flex h-11 w-11 items-center justify-center',
        'rounded-input bg-paper/90 text-ink',
        'transition-colors duration-150 ease-out hover:bg-paper',
        'disabled:opacity-60',
        className,
      )}
    >
      <svg
        width={size === 'lg' ? 20 : 16}
        height={size === 'lg' ? 20 : 16}
        viewBox="0 0 20 20"
        fill={isFavorite ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M10 16.5s-6-3.9-6-8a3.4 3.4 0 0 1 6-2.2A3.4 3.4 0 0 1 16 8.5c0 4.1-6 8-6 8Z" />
      </svg>
    </button>
  )
}
