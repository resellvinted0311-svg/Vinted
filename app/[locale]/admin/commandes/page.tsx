import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { OrderStatusBadge } from '@/components/shop/order/order-status-badge'
import { OrderAdvanceForm } from '@/components/admin/order-advance-form'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { listOrdersToFulfil } from '@/lib/db/queries/admin-orders'
import { formatPrice, formatDate } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('orders'), robots: { index: false, follow: false } }
}

/**
 * Les commandes qui attendent d'être expédiées.
 *
 * ---------------------------------------------------------------------------
 * Cette page remplace une boîte de réception
 * ---------------------------------------------------------------------------
 * Une commande payée ne se signalait que par un e-mail de notification. Un fil
 * archivé par erreur, une notification lue en marchant, et le colis ne partait
 * pas — sans que rien nulle part ne le rappelle. Une file de travail ne
 * s'oublie pas de la même façon : ce qui reste dessus est ce qui reste à faire.
 *
 * ---------------------------------------------------------------------------
 * L'adresse est écrite en entier, exprès
 * ---------------------------------------------------------------------------
 * C'est ce qu'on recopie sur l'étiquette. La replier derrière un lien vers un
 * détail obligerait à ouvrir un onglet par colis, et la recopie se ferait de
 * mémoire entre deux écrans — c'est ainsi qu'on inverse deux chiffres d'un code
 * postal.
 *
 * En revanche, ni le coût d'achat ni le coût transporteur : ils sont légitimes
 * en régie mais ne servent à rien pour emballer, et cet écran-là reste ouvert
 * pendant qu'on emballe.
 */
export default async function AdminOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Rattrapé plutôt que laissé remonter : sans cela, chaque accès refusé
  // inscrivait une erreur non gérée dans les journaux du serveur, à côté du
  // 404 que le layout produisait déjà correctement.
  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin')
  const orders = await listOrdersToFulfil()

  return (
    <div>
      <h1 className="text-2xl">{t('orders')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('ordersIntro')}</p>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('noPendingOrders')}</p>
          <p className="mt-1 text-xs text-muted">{t('noPendingOrdersHint')}</p>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
          {orders.map((order) => (
            <li key={order.id} className="flex flex-col gap-4 py-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span data-numeric className="text-base text-ink">
                    {order.orderNumber}
                  </span>
                  <span className="text-xs text-muted">
                    {t('pieces', { count: order.items.length })}
                  </span>
                  <span data-numeric className="text-xs text-muted">
                    {formatPrice(order.totalCents, locale)}
                  </span>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>

              {/*
                La date de paiement, pas celle de création : c'est à partir
                d'elle que l'attente court, et c'est elle qui ordonne la file.
              */}
              {order.paidAt ? (
                <p className="text-xs text-muted">
                  {t('paidOn', { date: formatDate(order.paidAt, locale) })}
                  {' · '}
                  {t('shippedTo', {
                    city: order.destination.city,
                    country: order.destination.country,
                  })}
                </p>
              ) : null}

              <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
                <section className="min-w-0 flex-1">
                  <h2 className="label-reg text-muted">{t('shippingLabel')}</h2>
                  {/*
                    `<address>` et non un paragraphe : c'est bien une adresse
                    postale, et les technologies d'assistance l'annoncent comme
                    telle.
                  */}
                  <address className="mt-2 not-italic text-sm text-ink">
                    {order.addressLines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </address>

                  <p className="data mt-2 text-xs text-muted">
                    {order.carrierCode} · {order.serviceCode}
                    {order.servicePointId ? ` · ${order.servicePointId}` : ''}
                    {' · '}
                    {t('contentWeight', { grams: order.contentWeightGrams })}
                  </p>
                </section>

                <section className="min-w-0 flex-1">
                  <h2 className="label-reg text-muted">{t('contents')}</h2>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-ink">
                    {order.items.map((item, index) => (
                      <li key={`${item.sku ?? item.title}-${index}`}>
                        {item.title}
                        {item.sku ? (
                          <span className="data ml-2 text-xs text-muted">
                            {item.sku}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  {/*
                    La note de l'acheteuse s'affiche ici et pas ailleurs : elle
                    dit parfois « laissez chez le voisin », et la lire après
                    l'expédition ne sert plus à rien.
                  */}
                  {order.customerNote ? (
                    <div className="mt-3 border-t border-sand pt-3">
                      <p className="label-reg text-muted">{t('customerNote')}</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-ink">
                        {order.customerNote}
                      </p>
                    </div>
                  ) : null}
                </section>
              </div>

              {order.tracking?.number ? (
                <p className="data text-xs text-muted">
                  {t('trackingLabel')} : {order.tracking.number}
                </p>
              ) : null}

              <OrderAdvanceForm orderId={order.id} actions={order.actions} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
