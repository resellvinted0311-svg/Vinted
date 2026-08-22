import { useTranslations, useLocale } from 'next-intl'
import { formatPrice, formatDate } from '@/lib/utils/format'
import { formatAddressLines } from '@/lib/domain/address'
import type { Invoice } from '@/lib/shop/invoice'

/**
 * La facture, telle qu'elle doit s'imprimer.
 *
 * ---------------------------------------------------------------------------
 * Ici, la charte devient une obligation
 * ---------------------------------------------------------------------------
 * Ailleurs sur le site, les filets et la chasse fixe sont un parti pris. Sur
 * ce document, ils servent une pièce comptable : un vendeur identifié, un
 * numéro, une date d'émission, des lignes, un total. Rien n'est décoratif.
 *
 * ---------------------------------------------------------------------------
 * Aucune valeur n'est inventée
 * ---------------------------------------------------------------------------
 * Dénomination, SIRET, adresse et mention de TVA viennent de la configuration
 * légale. `buildInvoice` REFUSE d'émettre si l'une manque — une facture sans
 * dénomination ni SIRET n'est pas incomplète, elle est sans valeur.
 *
 * La mention de franchise en base de TVA n'apparaît que si le régime est
 * déclaré : l'afficher par défaut ferait dire au document quelque chose de faux
 * sur la situation fiscale du vendeur.
 */
export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const t = useTranslations('invoice')
  const locale = useLocale()
  const price = (cents: number) => formatPrice(cents, locale)

  const billing = formatAddressLines(invoice.customer.billing)
  const shipping = formatAddressLines(invoice.customer.shipping)
  const sameAddress =
    billing.length === shipping.length &&
    billing.every((line, index) => line === shipping[index])

  return (
    <article className="rounded-card ruled bg-surface p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-[1.5px] border-rule pb-6">
        <div>
          <h1 className="text-2xl">{t('title')}</h1>
          <p data-numeric className="data mt-1 text-sm text-ink">
            {invoice.number}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t('issuedAt', { date: formatDate(invoice.issuedAt, locale) })}
          </p>
          <p data-numeric className="data mt-0.5 text-xs text-muted">
            {t('orderNumber', { number: invoice.orderNumber })}
          </p>
        </div>

        <div className="text-right text-xs text-muted">
          <p className="label-reg text-ink">{t('seller')}</p>
          <p className="mt-1 text-ink">{invoice.seller.name}</p>
          <p className="whitespace-pre-line">{invoice.seller.address}</p>
          <p data-numeric className="data mt-1">
            {t('siret', { siret: invoice.seller.siret })}
          </p>
          <p>{invoice.seller.email}</p>
        </div>
      </header>

      <section className="grid gap-6 border-b border-sand py-6 sm:grid-cols-2">
        <div>
          <p className="label-reg text-muted">{t('buyer')}</p>
          <address className="mt-2 not-italic text-sm text-ink">
            {billing.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
          <p className="mt-1 text-xs text-muted">{invoice.customer.email}</p>
        </div>

        {/* L'adresse de livraison n'est répétée que si elle DIFFÈRE : deux
            blocs identiques côte à côte font douter de laquelle fait foi. */}
        {sameAddress ? null : (
          <div>
            <p className="label-reg text-muted">{t('shippingTo')}</p>
            <address className="mt-2 not-italic text-sm text-ink">
              {shipping.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </div>
        )}
      </section>

      <section className="py-6">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('lines')}</caption>
          <thead>
            <tr className="border-b border-sand text-left">
              <th scope="col" className="label-reg pb-2 text-muted">
                {t('designation')}
              </th>
              <th scope="col" className="label-reg pb-2 text-muted">
                {t('reference')}
              </th>
              <th scope="col" className="label-reg pb-2 text-right text-muted">
                {t('amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={`${line.reference ?? line.label}-${index}`} className="border-b border-sand">
                <td className="py-2.5 text-ink">{line.label}</td>
                <td className="data py-2.5 text-xs text-muted">
                  {line.reference ?? ''}
                </td>
                <td data-numeric className="py-2.5 text-right text-ink">
                  {price(line.unitPriceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{t('subtotal')}</dt>
            <dd data-numeric className="text-ink">
              {price(invoice.subtotalCents)}
            </dd>
          </div>

          {invoice.discountCents > 0 ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{t('discount')}</dt>
              <dd data-numeric className="text-ink">
                −{price(invoice.discountCents)}
              </dd>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{t('shipping')}</dt>
            <dd data-numeric className="text-ink">
              {price(invoice.shippingCents)}
            </dd>
          </div>

          <div className="mt-1 flex items-baseline justify-between gap-4 border-t-[1.5px] border-rule pt-3">
            <dt className="label-reg text-ink">{t('total')}</dt>
            <dd data-numeric className="text-xl text-ink">
              {price(invoice.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      <footer className="border-t border-sand pt-6 text-xs text-muted">
        {invoice.seller.vatNotice ? (
          <p>{invoice.seller.vatNotice}</p>
        ) : null}

        {invoice.paidAt ? (
          <p className="mt-1">
            {t('paidAt', { date: formatDate(invoice.paidAt, locale) })}
          </p>
        ) : null}
      </footer>
    </article>
  )
}
