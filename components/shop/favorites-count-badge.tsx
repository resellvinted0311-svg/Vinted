'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { useSessionBoutique } from './session-provider'

/**
 * Compteur des favoris, dans l'en-tête.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il se charge après coup, comme celui du panier
 * ---------------------------------------------------------------------------
 * L'en-tête est rendu sur des pages statiques — accueil, catalogue, fiches
 * article — et ce sont elles qui portent le référencement. Lire les favoris
 * dans leur arbre de rendu les rendrait toutes dynamiques, et figerait un
 * « 0 » dans le HTML prérendu pour tout le monde.
 *
 * Le décompte vient donc de `/api/session`, après hydratation — par
 * `SessionProvider`, qui fait cette lecture une fois pour les trois outils de
 * l'en-tête au lieu de trois requêtes identiques.
 *
 * ---------------------------------------------------------------------------
 * Relu à chaque navigation, et pourquoi c'est nécessaire ICI
 * ---------------------------------------------------------------------------
 * Le panier a un événement (`nd:cart-changed`) parce que ses boutons vivent
 * dans les pages et savent le nombre exact que le serveur vient de compter.
 * Les favoris n'en ont pas : le bouton « cœur » d'une vignette bascule l'état
 * d'UNE pièce et n'a aucune raison de connaître le total.
 *
 * On se rabat donc sur le signal dont on dispose — le changement d'URL. Il
 * couvre le cas courant : on met une pièce en favori, puis on navigue, et le
 * compteur est juste à l'arrivée. Il ne couvre pas le cas où l'on reste sur la
 * même page en cochant plusieurs cœurs ; le compteur est alors en retard
 * jusqu'à la navigation suivante.
 *
 * C'est un retard ASSUMÉ et non un défaut oublié. L'alternative — un
 * événement de plus, propagé depuis chaque vignette — ajouterait un aller-
 * retour réseau par clic sur un cœur, pour un chiffre que personne ne
 * surveille pendant qu'il coche. Le jour où ce chiffre devient important, le
 * remède est le même motif que le panier, et il est déjà écrit à côté.
 *
 * ---------------------------------------------------------------------------
 * Rien n'est compté dans le navigateur
 * ---------------------------------------------------------------------------
 * Le nombre vient du serveur, qui vient de compter les lignes. On n'incrémente
 * jamais de son côté : un compteur tenu dans la page finit par diverger de la
 * base — deux onglets ouverts suffisent.
 */
export function FavoritesCountBadge({ className }: { className?: string }) {
  const t = useTranslations('nav')
  // La relecture à chaque changement d'adresse — le rattrapage décrit
  // ci-dessus — a lieu dans le fournisseur, une fois pour tout l'en-tête.
  const { etat } = useSessionBoutique()
  const count = etat?.favoriteCount ?? null

  // Tant que le décompte est inconnu, rien : une pastille « 0 » qui saute à
  // « 2 » après coup est plus déroutante qu'une absence.
  if (count === null || count === 0) return null

  return (
    <>
      {/*
        Le nombre est annoncé aux lecteurs d'écran, mais SÉPARÉMENT du dessin.

        Le lien parent ne porte pas de `aria-label` : un `aria-label` remplace
        le contenu de l'élément, et il aurait donc effacé ce compteur du nom
        accessible. Le libellé « Favoris » vit dans un `sr-only` du lien, ce
        texte-ci s'y ajoute, et l'ensemble se lit « Favoris, 3 pièces en
        favoris ».
      */}
      <span className="sr-only">{t('favoritesCount', { count })}</span>

      <span
        data-numeric
        aria-hidden
        className={cn(
          'data pointer-events-none absolute -right-0.5 -top-0.5',
          'inline-flex min-w-[1.25rem] items-center justify-center',
          'rounded-input border-[1.5px] border-rule bg-stamp px-1',
          'text-[0.6875rem] leading-tight text-ink-inverse',
          className,
        )}
      >
        {count}
      </span>
    </>
  )
}
