import { useTranslations } from 'next-intl'
import { Link } from '@/lib/i18n/navigation'
import { SITE } from '@/lib/config/site'
import { cn } from '@/lib/utils/cn'

/**
 * Signature de la boutique : le nom, et la baseline en plus petit dessous.
 *
 * Composée en Fraunces, sans logo dessiné : la marque tient dans sa
 * typographie, pas dans un pictogramme.
 */
export function Wordmark({
  size = 'md',
  className,
}: {
  size?: 'md' | 'lg'
  className?: string
}) {
  const t = useTranslations('site')

  return (
    <Link
      href="/"
      className={cn('inline-flex flex-col leading-none', className)}
    >
      <span
        className={cn(
          'font-display tracking-tight text-ink',
          size === 'lg' ? 'text-2xl' : 'text-lg',
        )}
      >
        {SITE.name}
      </span>
      <span
        className={cn(
          'mt-1 text-muted',
          size === 'lg' ? 'text-base' : 'text-xs',
        )}
      >
        {t('tagline')}
      </span>
    </Link>
  )
}
