import { useTranslations } from 'next-intl'
import { Link } from '@/lib/i18n/navigation'
import { SITE } from '@/lib/config/site'
import { cn } from '@/lib/utils/cn'

/**
 * Signature de la boutique.
 *
 * Composée en grotesque serrée, capitales, crénage négatif : la marque tient
 * dans sa typographie, pas dans un pictogramme dessiné. Le filet sous le nom
 * est le même trait que celui qui délimite une fiche d'inventaire — c'est ce
 * qui relie la signature au reste de la charte.
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
      className={cn('group inline-flex flex-col leading-none', className)}
    >
      <span
        className={cn(
          'font-display font-bold uppercase text-ink',
          size === 'lg'
            ? 'text-3xl tracking-[-0.045em] sm:text-4xl'
            : 'text-xl tracking-[-0.04em]',
        )}
      >
        {SITE.name}
      </span>

      <span
        aria-hidden
        className={cn(
          // Le filet de la signature porte le dégradé rose → cuivre. C'est le
          // seul trait du site qui le fasse : la signature est l'endroit où
          // une identité a le droit de se déclarer, une bordure de fiche non.
          'gradient-accent mt-1.5 block transition-[width] duration-200 ease-out',
          size === 'lg' ? 'h-[2px] w-16' : 'h-[1.5px] w-9',
          'group-hover:w-full',
        )}
      />

      <span
        className={cn(
          'label-reg mt-1.5 text-muted',
          size === 'lg' && 'text-xs tracking-[0.18em]',
        )}
      >
        {t('tagline')}
      </span>
    </Link>
  )
}
