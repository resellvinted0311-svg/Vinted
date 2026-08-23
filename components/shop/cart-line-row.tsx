import * as React from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils/cn'
import { formatDate, formatPrice } from '@/lib/utils/format'
import { isPurchasable } from '@/lib/domain/cart'
import type { CartLineView } from '@/lib/shop/cart'
import { ArticleImage } from './article-image'
import { CartLineStateNote } from './cart-line-state'

/**
 * Une ligne du panier, tenue comme une écriture de registre.
 *
 * Ordinal à gauche, référence d'inventaire, désignation, montant à droite. Une
 * ligne qui n'est plus payable garde sa place et son numéro : elle est barrée
 * d'un ton, jamais déplacée en bas ni repliée. Déplacer une ligne bloquée hors
 * du regard est déjà une forme de retrait silencieux.
 *
 * L'action — retirer — arrive par `children` plutôt que par un import : ce
 * composant est rendu depuis le serveur sur la page du panier et depuis le
 * client dans le récapitulatif du tunnel, où aucun bouton de retrait n'a sa
 * place une fois le paiement ouvert.
 */
export function CartLineRow({
  line,
  index,
  children,
}: {
  line: CartLineView
  /** Rang dans le bordereau, à partir de 1. */
  index: number
  children?: React.ReactNode
}) {
  const t = useTranslations('cart')
  const locale = useLocale()
  const payable = isPurchasable(line.state)

  return (
    <li
      className={cn(
        'grid grid-cols-[2.5rem_4.5rem_1fr] items-start gap-3 py-4 sm:gap-4',
        // Une ligne bloquée s'assourdit, elle ne disparaît pas.
        !payable && 'opacity-70',
      )}
    >
      <span data-numeric className="data pt-1 text-xs text-muted">
        {String(index).padStart(2, '0')}
      </span>

      {line.image ? (
        <Link
          href={`/a/${line.slug}`}
          className="block w-[4.5rem] overflow-hidden rounded-input border-[1.5px] border-rule"
          // La désignation juste à côté mène au même endroit : un second lien
          // vers la même cible ne fait qu'allonger la tabulation.
          tabIndex={-1}
          aria-hidden
        >
          <ArticleImage
            image={line.image}
            sizes="72px"
            className="aspect-[3/4]"
          />
        </Link>
      ) : (
        // Aucune photo : un cadre vide, pas une image de remplacement.
        <div
          aria-hidden
          className="aspect-[3/4] w-[4.5rem] rounded-input border-[1.5px] border-dashed border-sand-strong"
        />
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="data text-xs text-muted">
            {t('sku', { sku: line.sku })}
          </span>

          <Link
            href={`/a/${line.slug}`}
            className="text-base text-ink underline-offset-4 hover:underline"
          >
            {line.title}
          </Link>

          {line.brandName ? (
            <span className="label-reg text-muted">{line.brandName}</span>
          ) : null}

          <CartLineStateNote state={line.state} />

          {/*
            Nommer la raison de l'écart. Le prix barré seul se lit comme une
            promotion de la boutique ; c'est une négociation, et il vaut jusqu'à
            une date précise après laquelle le plein tarif revient.
          */}
          {line.negotiated ? (
            <p className="mt-1 text-xs text-muted">
              {t('negotiatedUntil', {
                date: formatDate(line.negotiated.priceValidUntil, locale),
              })}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
          {/*
            Le prix RÉELLEMENT DÛ, jamais celui mémorisé à la mise au panier :
            c'est lui qui sera facturé, et c'est lui que totalise le sous-total.

            Quand une offre acceptée l'abaisse, le prix affiché reste visible,
            barré. Montrer le seul montant négocié priverait la personne de la
            comparaison qu'elle vient précisément d'obtenir — et un montant plus
            bas sans explication ressemble à une erreur.
          */}
          <div className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0.5">
            {line.negotiated ? (
              <span
                data-numeric
                className="text-xs text-muted line-through"
                aria-hidden
              >
                {formatPrice(line.currentPriceCents, locale)}
              </span>
            ) : null}
            <span
              data-numeric
              className={cn(
                'text-lg',
                line.negotiated ? 'text-mark' : 'text-ink',
              )}
            >
              {formatPrice(line.payableCents, locale)}
            </span>
          </div>
          {children}
        </div>
      </div>
    </li>
  )
}
