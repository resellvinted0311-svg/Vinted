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
  tagline = true,
  className,
}: {
  size?: 'sm' | 'md' | 'lg'
  /**
   * Affiche la baseline sous le nom.
   *
   * Retirée dans la barre de navigation, où elle ajoutait une troisième ligne
   * à un élément qui reste à l'écran en permanence. La baseline n'est pas
   * perdue pour autant : elle ouvre la vitrine et ferme le colophon, deux
   * endroits où on la lit une fois, en entier.
   */
  tagline?: boolean
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
          // `whitespace-nowrap` n'est pas un détail : posé dans une colonne
          // étroite — la barre de navigation sur téléphone — le nom se coupait
          // en deux lignes, « Nina & » au-dessus de « Diego ». Une signature
          // qui se plie n'est plus une signature.
          'whitespace-nowrap font-display font-bold uppercase text-ink',
          size === 'lg' && 'text-3xl tracking-[-0.045em] sm:text-4xl',
          size === 'md' && 'text-xl tracking-[-0.04em]',
          // Le pas de la barre flottante : assez grand pour rester la
          // signature, assez court pour laisser la place au panier et au
          // compte sur la même ligne.
          size === 'sm' && 'text-lg tracking-[-0.04em] sm:text-xl',
        )}
      >
        {SITE.name}
      </span>

      {/*
        Il y avait ici un filet sous la signature, qui s'étirait au survol.

        Il a été retiré à la demande de la boutique. Il se défendait tant que la
        barre n'avait pas d'ornement propre ; depuis qu'elle porte une
        surpiqûre, deux traits se disputaient le même rôle à trois centimètres
        l'un de l'autre — et le fil blanc de la couture est plus fort que le
        filet.

        Le survol reste signalé : la signature est un lien, et son état
        survolé passe par la couleur du texte comme les autres liens de la
        barre.
      */}

      {tagline ? (
        <span
          className={cn(
            'label-reg mt-1.5 text-muted',
            size === 'lg' && 'text-xs tracking-[0.18em]',
          )}
        >
          {t('tagline')}
        </span>
      ) : null}
    </Link>
  )
}
