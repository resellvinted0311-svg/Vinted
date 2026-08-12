import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { formatPrice, discountPercent } from '@/lib/utils/format'

/**
 * Affichage d'un prix.
 *
 * Le prix barré n'apparaît que s'il existe réellement une baisse enregistrée.
 * Aucun prix de référence inventé : ce serait une pratique commerciale
 * trompeuse, et c'est sanctionné.
 */
export function Price({
  cents,
  compareCents = null,
  size = 'md',
  className,
}: {
  cents: number
  compareCents?: number | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const locale = useLocale()
  const discount = discountPercent(cents, compareCents)

  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span
        data-numeric
        className={cn(
          'text-ink',
          size === 'sm' && 'text-base',
          size === 'md' && 'text-lg',
          size === 'lg' && 'text-xl',
          discount !== null && 'text-clay',
        )}
      >
        {formatPrice(cents, locale)}
      </span>

      {discount !== null && compareCents ? (
        <>
          <span data-numeric className="text-xs text-muted line-through">
            {formatPrice(compareCents, locale)}
          </span>
          <span data-numeric className="text-xs text-clay">
            −{discount} %
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Variante serveur, quand le composant appelant n'est pas un client. */
export function PriceStatic({
  cents,
  compareCents = null,
  locale,
  className,
}: {
  cents: number
  compareCents?: number | null
  locale: string
  className?: string
}) {
  const discount = discountPercent(cents, compareCents)

  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span data-numeric className={cn('text-lg', discount !== null && 'text-clay')}>
        {formatPrice(cents, locale)}
      </span>
      {discount !== null && compareCents ? (
        <span data-numeric className="text-xs text-muted line-through">
          {formatPrice(compareCents, locale)}
        </span>
      ) : null}
    </span>
  )
}

/** Libellé d'état, traduit. */
export function ConditionLabel({ condition }: { condition: string }) {
  const t = useTranslations('condition')
  return <>{t(`${condition}.label`)}</>
}
