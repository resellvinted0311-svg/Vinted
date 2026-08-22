import { useTranslations, useFormatter, useLocale } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Stamp } from '@/components/ui/stamp'
import { formatPrice } from '@/lib/utils/format'
import type { CartLineState } from '@/lib/domain/cart'

/**
 * Qualification d'une ligne de panier.
 *
 * ---------------------------------------------------------------------------
 * Trois régimes, pas deux
 * ---------------------------------------------------------------------------
 * Le décompte du panier ne connaît que « payable » et « bloquée ». L'écran
 * doit en distinguer une de plus :
 *
 *  - rien à dire — la ligne se lit comme les autres ;
 *  - signalée MAIS payable — le prix a bougé depuis la mise au panier. La
 *    pièce s'achète, au prix courant, et le sous-total la compte. Le signaler
 *    est une obligation d'information, pas un avertissement ;
 *  - bloquante — la pièce n'est plus achetable. Elle reste affichée, à sa
 *    place, avec son motif.
 *
 * Confondre les deux derniers ferait passer une baisse de prix pour un
 * problème.
 *
 * ---------------------------------------------------------------------------
 * Aucun prix barré ici
 * ---------------------------------------------------------------------------
 * Le prix mémorisé à la mise au panier n'est pas un prix de référence : il n'a
 * jamais été le prix public de la pièce à un autre moment que celui-là. Le
 * barrer et afficher un pourcentage fabriquerait une remise qui n'existe pas —
 * ce que l'article L112-1-1 du code de la consommation encadre précisément.
 * On écrit donc les deux montants en toutes lettres.
 *
 * ---------------------------------------------------------------------------
 * Isomorphe
 * ---------------------------------------------------------------------------
 * Ni `'use client'`, ni import `server-only` : la page du panier le rend sur
 * le serveur, le récapitulatif du tunnel le rend sur le client. Les crochets
 * `useTranslations` et `useFormatter` fonctionnent des deux côtés.
 */
export function CartLineStateNote({ state }: { state: CartLineState }) {
  const t = useTranslations('cart.state')
  const format = useFormatter()
  const locale = useLocale()
  const price = (cents: number) => formatPrice(cents, locale)

  switch (state.kind) {
    case 'ok':
      return null

    case 'price-lowered':
      return (
        <p className="text-xs text-success">
          {t('priceLowered', {
            old: price(state.snapshotCents),
            new: price(state.currentCents),
          })}
        </p>
      )

    case 'price-raised':
      return (
        <p className="text-xs text-warning">
          {t('priceRaised', {
            old: price(state.snapshotCents),
            new: price(state.currentCents),
          })}
        </p>
      )

    case 'reserved-by-other':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning">{t('reservedByOther')}</Badge>
          {/*
            Aucun compte à rebours, et c'est un choix : la réservation se
            reprend par son propre titulaire, sa fin réelle n'est donc pas
            prévisible. Un décompte serait faux, et un décompte faux sur une
            pièce qu'on veut est exactement le mécanisme d'urgence que le
            cahier des charges interdit.
          */}
          {state.until ? (
            <span className="data text-xs text-muted">
              {t('reservedByOtherUntil', {
                until: format.dateTime(state.until, {
                  hour: 'numeric',
                  minute: 'numeric',
                }),
              })}
            </span>
          ) : null}
        </div>
      )

    case 'sold':
      return (
        <div className="flex items-center gap-2">
          <Stamp straight>{t('stampSold')}</Stamp>
          <span className="text-xs text-muted">{t('sold')}</span>
        </div>
      )

    case 'unavailable':
      return (
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{t('stampWithdrawn')}</Badge>
          <span className="text-xs text-muted">{t('unavailable')}</span>
        </div>
      )
  }
}
