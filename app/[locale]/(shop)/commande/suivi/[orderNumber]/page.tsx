import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { readCartOwner } from '@/lib/shop/cart'
import { getOrder } from '@/lib/db/queries/orders'
import { OrderDetailView } from '@/components/shop/order/order-detail-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; orderNumber: string }>
}): Promise<Metadata> {
  const { locale, orderNumber } = await params
  const t = await getTranslations({ locale, namespace: 'order' })
  return {
    title: t('detailTitle', { orderNumber }),
    robots: { index: false, follow: false },
  }
}

/**
 * Le détail d'une commande.
 *
 * ---------------------------------------------------------------------------
 * « Introuvable » et « pas à vous » disent la même chose
 * ---------------------------------------------------------------------------
 * Et c'est délibéré. Un numéro de commande est court, lisible et séquentiel :
 * distinguer les deux cas transformerait cette page en outil pour savoir
 * combien de commandes la boutique a reçues, et lesquelles existent.
 *
 * La page de retour de paiement fait la distinction, elle, parce qu'elle
 * s'appuie sur l'identifiant de session Stripe — long, imprévisible, et déjà
 * connu de qui l'a obtenu.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orderNumber: string }>
}) {
  const { locale, orderNumber } = await params
  setRequestLocale(locale)

  const t = await getTranslations('order')
  const owner = await readCartOwner()
  const order = owner ? await getOrder(owner, orderNumber) : null

  if (!order) {
    return (
      <div className="mx-auto max-w-[36rem] px-4 pb-24 pt-16 sm:px-6">
        <h1 className="text-2xl">{t('detailTitle', { orderNumber })}</h1>

        <Notice tone="warning" role="status" className="mt-6">
          <p>{t('notFound')}</p>
        </Notice>

        <Button asChild variant="outline" size="sm" className="mt-6">
          <Link href="/commande/suivi">{t('backToRegister')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <OrderDetailView order={order} />

      <div className="mt-8 flex flex-wrap gap-3">
        {order.invoiceNumber ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/commande/suivi/${order.orderNumber}/facture`}>
              {t('viewInvoice')}
            </Link>
          </Button>
        ) : null}

        <Button asChild variant="ghost" size="sm">
          <Link href="/commande/suivi">{t('backToRegister')}</Link>
        </Button>
      </div>
    </div>
  )
}
