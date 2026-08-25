import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { logger } from '@/lib/observability/logger'
import { readCartOwner } from '@/lib/shop/cart'
import { getOrder } from '@/lib/db/queries/orders'
import { buildInvoice, LegalIdentityMissingError } from '@/lib/shop/invoice'
import { InvoiceDocument } from '@/components/shop/order/invoice-document'
import { PrintButton } from '@/components/shop/order/print-button'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; orderNumber: string }>
}): Promise<Metadata> {
  const { locale, orderNumber } = await params
  const t = await getTranslations({ locale, namespace: 'invoice' })
  return {
    title: `${t('title')} — ${orderNumber}`,
    robots: { index: false, follow: false },
  }
}

/**
 * La facture d'une commande.
 *
 * ---------------------------------------------------------------------------
 * Trois issues, aucune 500
 * ---------------------------------------------------------------------------
 *  - la commande n'est pas la vôtre, ou n'existe pas : un seul message, comme
 *    sur la page de détail ;
 *  - aucun numéro de facture : la commande n'a pas encore été encaissée. On le
 *    dit. Inventer un numéro « prévisionnel » donnerait une référence
 *    comptable qui n'existe pas, dans un document que la personne pourrait
 *    citer ;
 *  - l'identité légale de la boutique est incomplète : `buildInvoice` REFUSE
 *    d'émettre, et c'est la bonne décision — une facture sans dénomination ni
 *    SIRET est sans valeur. Mais l'erreur est de NOTRE côté : on l'attrape ici
 *    plutôt que de renvoyer une page cassée, et on n'écrit surtout pas
 *    « il manque le SIRET du vendeur », qui n'apprendrait rien à l'acheteuse
 *    et renseignerait tout le monde sur l'état de notre configuration.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ locale: string; orderNumber: string }>
}) {
  const { locale, orderNumber } = await params
  setRequestLocale(locale)

  const t = await getTranslations('invoice')
  const tOrder = await getTranslations('order')

  const owner = await readCartOwner()
  const order = owner ? await getOrder(owner, orderNumber) : null

  if (!order) {
    return (
      <Shell orderNumber={orderNumber} title={t('title')}>
        <Notice tone="warning" role="status">
          <p>{tOrder('notFound')}</p>
        </Notice>
      </Shell>
    )
  }

  if (!order.invoiceNumber) {
    return (
      <Shell orderNumber={orderNumber} title={t('title')}>
        <Notice tone="neutral" role="status" title={t('notIssued')}>
          <p>{t('notIssuedHint')}</p>
        </Notice>
      </Shell>
    )
  }

  let invoice
  try {
    invoice = buildInvoice(order)
  } catch (error) {
    if (!(error instanceof LegalIdentityMissingError)) throw error

    // Le journal du serveur porte le détail. L'écran, lui, dit seulement que
    // le document n'est pas disponible et comment l'obtenir autrement.
    logger.error('invoice.legal_identity_missing', { orderNumber })

    return (
      <Shell orderNumber={orderNumber} title={t('title')}>
        <Notice tone="warning" role="status">
          <p>{t('unavailable')}</p>
        </Notice>
      </Shell>
    )
  }

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <div data-print-hide className="mb-6 flex flex-wrap items-center gap-3">
        <PrintButton />
        <Button asChild variant="ghost" size="sm">
          <Link href={`/commande/suivi/${orderNumber}`}>
            {tOrder('backToOrder')}
          </Link>
        </Button>
      </div>

      <InvoiceDocument invoice={invoice} />
    </div>
  )
}

async function Shell({
  orderNumber,
  title,
  children,
}: {
  orderNumber: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-[36rem] px-4 pb-24 pt-16 sm:px-6">
      <h1 className="text-2xl">{title}</h1>
      <p data-numeric className="data mt-1 text-xs text-muted">
        {orderNumber}
      </p>
      <div className="mt-6">{children}</div>
    </div>
  )
}
