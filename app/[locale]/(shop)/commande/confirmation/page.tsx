import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { Stamp } from '@/components/ui/stamp'
import { readCartOwner } from '@/lib/shop/cart'
import {
  getOrderByCheckoutSession,
  checkoutSessionExists,
} from '@/lib/db/queries/orders'
import { OrderDetailView } from '@/components/shop/order/order-detail-view'
import { OrderStatusPoll } from '@/components/shop/order/order-status-poll'

/** Dépend de la session : jamais mise en cache. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'order' })
  return {
    title: t('confirmationTitle'),
    robots: { index: false, follow: false },
  }
}

/**
 * Le récépissé.
 *
 * ---------------------------------------------------------------------------
 * Cette page NE MARQUE RIEN comme payé
 * ---------------------------------------------------------------------------
 * Elle lit l'état que le webhook signé a écrit. C'est une redirection du
 * navigateur : n'importe qui peut l'ouvrir à la main, avec n'importe quel
 * identifiant de session. Seul le webhook fait foi.
 *
 * ---------------------------------------------------------------------------
 * Trois issues, et aucune ne dit « échec »
 * ---------------------------------------------------------------------------
 *  - payée : le récépissé complet ;
 *  - en attente : le webhook n'est pas encore passé. La page le dit, et
 *    interroge à intervalle régulier ;
 *  - introuvable : soit la session n'existe pas, soit elle appartient à
 *    quelqu'un d'autre. On distingue les deux ici — et SEULEMENT ici — parce
 *    que l'identifiant de session Stripe est long et imprévisible : le
 *    connaître prouve déjà qu'on est passé par le paiement, et savoir qu'une
 *    commande existe n'apprend rien de plus à qui la possède déjà.
 *
 * La même distinction serait dangereuse sur un NUMÉRO de commande, court et
 * lisible ; la page de suivi ne la fait donc pas.
 */
export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  const { locale } = await params
  const { session_id: sessionId } = await searchParams
  setRequestLocale(locale)

  const t = await getTranslations('order')

  if (!sessionId) {
    return <UnknownOrder locale={locale} messageKey="unknownReference" />
  }

  const owner = await readCartOwner()
  const order = owner
    ? await getOrderByCheckoutSession(owner, sessionId)
    : null

  if (!order) {
    const exists = await checkoutSessionExists(sessionId)
    return (
      <UnknownOrder
        locale={locale}
        messageKey={exists ? 'notYours' : 'unknownReference'}
      />
    )
  }

  const settled = order.status !== 'PENDING_PAYMENT'

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      {settled ? (
        <div className="mb-8 flex flex-wrap items-center gap-4">
          <Stamp>{t('paidStamp')}</Stamp>
          <div>
            <h1 className="text-2xl">{t('confirmationTitle')}</h1>
            {/* Au futur : l'envoi passe par la file de travaux, il n'a pas
                encore eu lieu quand cette page s'affiche. */}
            <p className="mt-1 text-xs text-muted">
              {t('emailSent', { email: order.email })}
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-8 flex flex-col gap-4">
          <h1 className="text-2xl">{t('confirmationTitle')}</h1>
          <OrderStatusPoll sessionId={sessionId} />
        </div>
      )}

      <OrderDetailView order={order} />

      <div className="mt-8 flex flex-wrap gap-3">
        {/* La facture n'existe que si un numéro lui a été attribué, c'est-à-dire
            après encaissement. Un lien vers une facture inexistante mènerait à
            une page qui s'excuse. */}
        {order.invoiceNumber ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/commande/suivi/${order.orderNumber}/facture`}>
              {t('viewInvoice')}
            </Link>
          </Button>
        ) : null}

        <Button asChild variant="ghost" size="sm">
          <Link href="/catalogue">{t('backToCatalogue')}</Link>
        </Button>
      </div>
    </div>
  )
}

/** Ni « échec », ni « rien n'a été débité » : on ne sait pas, on le dit. */
async function UnknownOrder({
  locale,
  messageKey,
}: {
  locale: string
  messageKey: 'notYours' | 'unknownReference'
}) {
  const t = await getTranslations({ locale, namespace: 'order' })

  return (
    <div className="mx-auto max-w-[36rem] px-4 pb-24 pt-16 sm:px-6">
      <h1 className="text-2xl">{t('confirmationTitle')}</h1>

      <Notice tone="warning" role="status" className="mt-6">
        <p>{t(messageKey)}</p>
      </Notice>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/commande/suivi">{t('findMyOrder')}</Link>
        </Button>
      </div>
    </div>
  )
}
