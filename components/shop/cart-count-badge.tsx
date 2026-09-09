'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { CART_CHANGED_EVENT, type CartChangedDetail } from './cart-events'
import { useSessionBoutique } from './session-provider'

/**
 * Compteur du panier, dans l'en-tête.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il se charge après coup
 * ---------------------------------------------------------------------------
 * L'en-tête est rendu sur des pages statiques — accueil, catalogue, fiches
 * article — et ce sont elles qui portent le référencement. Lire le panier dans
 * leur arbre de rendu les rendrait toutes dynamiques, et figerait un « 0 » dans
 * le HTML prérendu pour tout le monde.
 *
 * Le décompte vient donc de `/api/session`, après hydratation, comme l'état de
 * session lui-même — mais il ne l'appelle plus lui-même : trois composants de
 * l'en-tête le faisaient chacun de leur côté, soit trois requêtes identiques
 * par chargement de page. `SessionProvider` fait la lecture pour les trois.
 *
 * ---------------------------------------------------------------------------
 * Rien n'est compté dans le navigateur
 * ---------------------------------------------------------------------------
 * Après un ajout ou un retrait, le composant reçoit le nombre que le SERVEUR
 * vient de compter. Il n'incrémente jamais de son côté : un compteur tenu dans
 * la page finit par diverger de la base — deux onglets ouverts suffisent — et
 * un panier qui annonce trois pièces pour deux est pire qu'un panier muet.
 */
export function CartCountBadge({ className }: { className?: string }) {
  const t = useTranslations('nav')
  const { etat } = useSessionBoutique()

  /*
    DEUX sources, et l'ordre entre elles compte.

    Le fournisseur donne le nombre qu'avait le serveur au chargement de la
    page. L'événement donne celui que le serveur vient de compter après un
    ajout ou un retrait — plus récent, donc prioritaire tant qu'on reste sur la
    même page.

    L'état local part donc du fournisseur et n'est ensuite écrasé que par
    l'événement. Sans ce dernier, ajouter une pièce ne changerait le compteur
    qu'à la navigation suivante.
  */
  const [apresEvenement, setApresEvenement] = useState<number | null>(null)

  useEffect(() => {
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<CartChangedDetail>).detail
      if (typeof detail?.count === 'number') setApresEvenement(detail.count)
    }

    window.addEventListener(CART_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(CART_CHANGED_EVENT, onChanged)
  }, [])

  const count = apresEvenement ?? etat?.cartCount ?? null

  // Tant que le décompte est inconnu, rien : une pastille « 0 » qui saute à
  // « 2 » après coup est plus déroutante qu'une absence.
  if (count === null || count === 0) return null

  return (
    <>
      {/*
        Le nombre est ANNONCÉ, et il ne l'était plus.

        Ce commentaire disait « le nombre est déjà dans le libellé du lien
        parent », et c'était vrai tant que ce libellé était le texte
        « Panier ». Depuis que l'entrée est devenue une icône, le lien porte
        son nom dans un `sr-only` — et un `aria-label` posé sur le lien aurait
        REMPLACÉ tout son contenu, effaçant le compteur du nom accessible.
        Une personne au lecteur d'écran aurait entendu « Panier » avec deux
        pièces dedans, sans jamais l'apprendre.

        Le libellé et le nombre sont donc deux textes voisins, lus à la suite.
      */}
      <span className="sr-only">{t('cartCount', { count })}</span>

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
