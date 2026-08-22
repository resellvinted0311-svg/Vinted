import { useTranslations, useLocale } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { formatPrice } from '@/lib/utils/format'

/**
 * Les quatre postes d'un total, tenus en liste de définitions.
 *
 * Sous-total, remise, port, total dû. Un `dl` et non un tableau : ce sont des
 * couples intitulé/valeur, pas une grille à deux axes, et c'est ce que les
 * lecteurs d'écran annoncent correctement.
 *
 * ---------------------------------------------------------------------------
 * Le port manquant se dit, il ne s'estime pas
 * ---------------------------------------------------------------------------
 * Tant qu'aucune adresse n'a été saisie, le port est INCONNU — pas « à partir
 * de », pas « environ ». Afficher un montant provisoire qui changerait ensuite
 * est précisément ce qui fait abandonner un panier, et c'est aussi ce que la
 * loi range du côté de l'information trompeuse. La ligne existe donc, avec sa
 * mention, et le total dû n'est annoncé qu'une fois le port connu.
 */
export function TotalsSheet({
  subtotalCents,
  discountCents = 0,
  /** `null` : pas encore calculable. `0` : offert. */
  shippingCents,
  className,
}: {
  subtotalCents: number
  discountCents?: number
  shippingCents: number | null
  className?: string
}) {
  const t = useTranslations('cart')
  const locale = useLocale()
  const price = (cents: number) => formatPrice(cents, locale)

  const totalCents =
    shippingCents === null
      ? null
      : subtotalCents - discountCents + shippingCents

  return (
    <dl className={cn('flex flex-col gap-2 text-sm', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">{t('subtotal')}</dt>
        <dd data-numeric className="text-ink">
          {price(subtotalCents)}
        </dd>
      </div>

      {/* La remise n'apparaît que s'il y en a une : une ligne « −0,00 € » ne
          renseigne personne et laisse croire à un code promotionnel oublié. */}
      {discountCents > 0 ? (
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{t('discount')}</dt>
          <dd data-numeric className="text-success">
            −{price(discountCents)}
          </dd>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">{t('shipping')}</dt>
        <dd
          className={cn(
            shippingCents === null ? 'text-xs text-muted' : 'text-ink',
          )}
          {...(shippingCents === null ? {} : { 'data-numeric': '' })}
        >
          {shippingCents === null
            ? t('shippingLater')
            : shippingCents === 0
              ? t('freeShipping')
              : price(shippingCents)}
        </dd>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-4 border-t-[1.5px] border-rule pt-3">
        <dt className="label-reg text-ink">{t('total')}</dt>
        <dd
          className={cn(
            totalCents === null ? 'text-xs text-muted' : 'text-xl text-ink',
          )}
          {...(totalCents === null ? {} : { 'data-numeric': '' })}
        >
          {totalCents === null ? t('totalLater') : price(totalCents)}
        </dd>
      </div>
    </dl>
  )
}
