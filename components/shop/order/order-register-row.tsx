import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/lib/i18n/navigation'
import { formatPrice, formatDate } from '@/lib/utils/format'
import type { OrderListItem } from '@/lib/db/queries/orders'
import { OrderStatusBadge } from './order-status-badge'

/**
 * Une ligne du registre des commandes.
 *
 * Sert deux pages — l'historique du compte et le suivi sans compte — parce
 * qu'une commande passée en visiteur et une commande passée connecté sont la
 * même chose. Les présenter différemment laisserait croire le contraire.
 *
 * ---------------------------------------------------------------------------
 * Le lien porte le NUMÉRO, pas un jeton
 * ---------------------------------------------------------------------------
 * L'accès est décidé par la portée du propriétaire, côté serveur. Un lien de
 * suivi à jeton dans l'URL circulerait dans les historiques de navigation et
 * les captures d'écran, et ouvrirait une commande — donc une adresse postale —
 * à quiconque le recopie.
 */
export function OrderRegisterRow({
  order,
  basePath,
}: {
  order: OrderListItem
  /** `/compte/commandes` ou `/commande/suivi`, selon la page appelante. */
  basePath: string
}) {
  const t = useTranslations('order')
  const locale = useLocale()

  const pieces = order.items.length

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`${basePath}/${order.orderNumber}`}
          className="data text-base text-ink underline-offset-4 hover:underline"
        >
          {order.orderNumber}
        </Link>

        <span className="text-xs text-muted">
          {formatDate(order.createdAt, locale)}
          {' · '}
          {t('pieces', { count: pieces })}
        </span>

        {/*
          Le numéro de facture n'apparaît que s'il a été attribué. En inventer
          un « prévisionnel » donnerait une référence comptable qui n'existe
          pas, dans un document que la personne pourrait citer.
        */}
        {order.invoiceNumber ? (
          <span className="data text-xs text-muted">
            {t('invoiceNumber', { number: order.invoiceNumber })}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <OrderStatusBadge status={order.status} />
        <span data-numeric className="text-base text-ink">
          {formatPrice(order.totalCents, locale)}
        </span>
      </div>
    </li>
  )
}
