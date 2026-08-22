'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { CART_CHANGED_EVENT, type CartChangedDetail } from './cart-events'

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
 * session lui-même.
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
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch('/api/session', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) return
        const body: unknown = await response.json()
        if (
          typeof body === 'object' &&
          body !== null &&
          'cartCount' in body &&
          typeof body.cartCount === 'number'
        ) {
          setCount(body.cartCount)
        }
      } catch {
        // Panne réseau ou navigation en cours : l'en-tête reste sans compteur
        // plutôt que d'en afficher un faux.
      }
    }

    void load()

    function onChanged(event: Event) {
      const detail = (event as CustomEvent<CartChangedDetail>).detail
      if (typeof detail?.count === 'number') setCount(detail.count)
    }

    window.addEventListener(CART_CHANGED_EVENT, onChanged)
    return () => {
      controller.abort()
      window.removeEventListener(CART_CHANGED_EVENT, onChanged)
    }
  }, [])

  // Tant que le décompte est inconnu, rien : une pastille « 0 » qui saute à
  // « 2 » après coup est plus déroutante qu'une absence.
  if (count === null || count === 0) return null

  return (
    <span
      data-numeric
      // Le nombre est déjà dans le libellé du lien parent : l'annoncer une
      // seconde fois ferait lire « Panier 2 2 ».
      aria-hidden
      className={cn(
        'data inline-flex min-w-[1.25rem] items-center justify-center',
        'rounded-input border-[1.5px] border-rule bg-stamp px-1',
        'text-[0.6875rem] leading-tight text-ink-inverse',
        className,
      )}
    >
      {count}
    </span>
  )
}
