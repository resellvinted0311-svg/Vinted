import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/lib/i18n/navigation'
import { formatPrice, formatDate } from '@/lib/utils/format'
import { readPostalAddress, formatAddressLines } from '@/lib/domain/address'
import type { OrderDetail } from '@/lib/db/queries/orders'
import { OrderStatusBadge } from './order-status-badge'

/**
 * Le détail d'une commande archivée.
 *
 * ---------------------------------------------------------------------------
 * Tout vient des instantanés
 * ---------------------------------------------------------------------------
 * Titres, prix, adresse : tels qu'ils étaient au moment de la commande. Relire
 * le catalogue afficherait le prix du jour, pas celui payé — et le jour où une
 * pièce baisse, la personne verrait une commande qui contredit son relevé
 * bancaire.
 *
 * ---------------------------------------------------------------------------
 * Aucun suivi n'est promis
 * ---------------------------------------------------------------------------
 * Les expéditions n'existent pas encore en base. Afficher un « suivi » vide,
 * ou un lien vers un transporteur sans numéro, promettrait une information
 * qu'on n'a pas. La ligne apparaîtra quand l'expédition existera.
 */
export function OrderDetailView({ order }: { order: OrderDetail }) {
  const t = useTranslations('order')
  const locale = useLocale()
  const price = (cents: number) => formatPrice(cents, locale)

  const addressLines = formatAddressLines(
    readPostalAddress(order.shippingAddress),
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h1 data-numeric className="text-2xl">
            {order.orderNumber}
          </h1>
          <p className="text-xs text-muted">
            {formatDate(order.createdAt, locale)}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <section className="rounded-card ruled bg-surface p-5">
        <h2 className="label-reg text-ink">{t('items')}</h2>

        <ul className="mt-4 divide-y divide-sand">
          {order.items.map((item, index) => (
            <li
              key={`${item.article?.sku ?? item.titleSnapshot}-${index}`}
              className="flex items-baseline justify-between gap-4 py-3"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-base text-ink">{item.titleSnapshot}</span>
                {item.article ? (
                  <Link
                    href={`/a/${item.article.slug}`}
                    className="data text-xs text-muted underline-offset-4 hover:underline"
                  >
                    {item.article.sku}
                  </Link>
                ) : null}
              </span>
              <span data-numeric className="text-base text-ink">
                {price(item.unitPriceCents)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 flex flex-col gap-2 border-t-[1.5px] border-rule pt-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{t('subtotal')}</dt>
            <dd data-numeric className="text-ink">
              {price(order.subtotalCents)}
            </dd>
          </div>

          {order.discountCents > 0 ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{t('discount')}</dt>
              <dd data-numeric className="text-success">
                −{price(order.discountCents)}
              </dd>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{t('shipping')}</dt>
            <dd data-numeric className="text-ink">
              {order.shippingCents === 0
                ? t('freeShipping')
                : price(order.shippingCents)}
            </dd>
          </div>

          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-sand pt-3">
            <dt className="label-reg text-ink">{t('total')}</dt>
            <dd data-numeric className="text-xl text-ink">
              {price(order.totalCents)}
            </dd>
          </div>

          {/* Un remboursement partiel se dit à part : le total encaissé reste
              ce qu'il a été, et le confondre avec lui effacerait la trace. */}
          {order.refundedCents > 0 ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{t('refunded')}</dt>
              <dd data-numeric className="text-warning">
                −{price(order.refundedCents)}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-card ruled bg-surface p-5">
        <h2 className="label-reg text-ink">{t('shippingTo')}</h2>

        <address className="mt-3 not-italic text-sm text-ink">
          {addressLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>

        <p className="mt-4 text-xs text-muted">
          {t('carrier', {
            carrier: order.shippingCarrierCode,
            service: order.shippingServiceCode,
          })}
        </p>

        {order.servicePointId ? (
          <p className="data mt-1 text-xs text-muted">
            {t('servicePoint', { id: order.servicePointId })}
          </p>
        ) : null}

        {order.customerNote ? (
          <div className="mt-4 border-t border-sand pt-4">
            <p className="label-reg text-muted">{t('customerNote')}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink">
              {order.customerNote}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
