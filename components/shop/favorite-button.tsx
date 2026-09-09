'use client'

import { useTransition } from 'react'
import { useLocale } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { useFavorites } from './favorites-provider'
import { toggleFavoriteFromForm } from '@/lib/shop/favorites'

/**
 * Bouton favori.
 *
 * Un cœur plein ou vide, sans compteur ni animation d'attention. La zone de
 * clic fait 44 px même si l'icône est petite, et l'état est annoncé par
 * `aria-pressed` plutôt que par la seule couleur.
 *
 * Posé sur la photo, il porte le contour plein de la charte : sans lui, il
 * flotterait sur les visuels clairs et disparaîtrait sur les visuels sombres.
 *
 * ---------------------------------------------------------------------------
 * UN FORMULAIRE, et pas seulement un bouton
 * ---------------------------------------------------------------------------
 * C'était un `onClick`, donc rien du tout script coupé — la seule commande de
 * la boutique dans ce cas. Le bouton restait pourtant actif à l'écran : on
 * cliquait, et il ne se passait rien qu'aucun message n'expliquait.
 *
 * Le voici enveloppé dans un formulaire qui vise une action serveur. Sans
 * script, le navigateur poste et l'action range la pièce puis renvoie vers la
 * liste des favoris, où on la voit. Avec script, le gestionnaire ci-dessous
 * prend la main avant l'envoi et garde ce qui existait : bascule optimiste,
 * aucun rechargement, aucune perte de la place dans la grille.
 *
 * Le formulaire est en `display: contents` : il ne fabrique aucune boîte, donc
 * il ne change rien à la mise en page — le bouton reste exactement là où la
 * fiche l'a posé.
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
  const locale = useLocale()

  return (
    <form action={toggleFavoriteFromForm} className="contents">
      {/*
        La langue accompagne l'article : l'action serveur redirige vers les
        favoris, et elle doit savoir dans quelle langue. Elle la valide contre
        la liste fermée des langues du site — rien de ce qui est posté ici ne
        compose librement une adresse.
      */}
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="locale" value={locale} />

      <button
        type="submit"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? labelRemove : label}
        title={isFavorite ? labelRemove : label}
        disabled={isPending}
        onClick={(event) => {
          /*
          Le clic est intercepté ICI, et pas dans `onSubmit` du formulaire.

          La vignette entière est cliquable par un pseudo-élément posé sur le
          titre : sans `stopPropagation`, mettre en favori ouvrirait aussi la
          fiche de l'article. Il faut donc arrêter l'événement au bouton, avant
          qu'il ne remonte — ce qu'un gestionnaire d'envoi ne peut plus faire,
          puisqu'il s'exécute après.

          `preventDefault` supprime au passage l'envoi du formulaire : c'est
          exactement ce qu'on veut quand le script est là. Sans script, ce
          gestionnaire n'existe pas, et le formulaire part normalement.
        */
          event.preventDefault()
          event.stopPropagation()
          startTransition(async () => {
            await toggle(articleId)
          })
        }}
        className={cn(
          'lift relative z-10 inline-flex h-11 w-11 items-center justify-center',
          'rounded-input border-[1.5px] border-rule bg-paper',
          isFavorite ? 'text-mark' : 'text-ink',
          'hover:bg-paper-raised',
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
    </form>
  )
}
