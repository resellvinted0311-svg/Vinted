import { Link } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils/cn'
import { ArticleImage } from './article-image'

/**
 * Une carte d'entrée : une image, et son intitulé posé par-dessus.
 *
 * Sert aux deux cartes d'univers de la vitrine et aux cartes de sous-catégorie
 * des pages d'univers. Un seul composant parce que c'est un seul objet — ce
 * qui change d'un emploi à l'autre est le format et le nombre, pas la nature.
 *
 * ---------------------------------------------------------------------------
 * Le cas SANS photographie est le cas NORMAL, pas le cas dégradé
 * ---------------------------------------------------------------------------
 * La boutique ouvre sans aucun visuel. Une carte vide ne doit donc pas
 * ressembler à une image qui n'a pas chargé : elle porte le lavis rose → cuivre
 * de la maison, le même que celui d'une vignette sans photo, et son intitulé
 * s'y lit à pleine encre.
 *
 * ---------------------------------------------------------------------------
 * Le voile n'existe QUE s'il y a une image, et il n'est pas décoratif
 * ---------------------------------------------------------------------------
 * Sur le lavis, l'encre passe à plus de douze contre un. Sur une photographie
 * inconnue — un mur clair, un vêtement blanc — elle peut tomber à un contre
 * un, et l'intitulé disparaît. Le dégradé sombre posé sous le texte garantit
 * le contraste quelle que soit la photo, et il n'est rendu que dans ce cas :
 * appliqué au lavis, il l'assombrirait pour rien.
 *
 * C'est la même règle, et pour la même raison, que dans le visuel d'arrivée.
 */
export function PictureCard({
  href,
  title,
  detail,
  image,
  ratio,
  priority = false,
  sizes,
}: {
  /** Chemin SANS préfixe de langue : `Link` de next-intl l'ajoute. */
  href: string
  title: string
  /** Ligne secondaire — un effectif, en général. Facultative. */
  detail?: string | null
  /**
   * L'image, ou `null` tant qu'il n'y en a pas.
   *
   * Les dimensions sont exigées avec l'adresse : sans elles, le ratio n'est
   * pas réservé avant chargement et la page saute quand l'image arrive.
   */
  image: { url: string; width: number; height: number } | null
  /** Classe de proportion, ex. `aspect-[4/5]`. */
  ratio: string
  priority?: boolean
  sizes: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'card-pick group relative flex overflow-hidden rounded-card ruled',
        ratio,
      )}
    >
      {image ? (
        <ArticleImage
          image={{ ...image, alt: null, blurhash: null }}
          sizes={sizes}
          priority={priority}
          className="absolute inset-0"
        />
      ) : (
        <span aria-hidden className="wash-accent absolute inset-0" />
      )}

      {/* Le voile, uniquement sous une vraie photographie. */}
      {image ? (
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--ink)_78%,transparent)_0%,color-mix(in_oklab,var(--ink)_28%,transparent)_45%,transparent_75%)]"
        />
      ) : null}

      <span
        className={cn(
          'relative mt-auto flex w-full flex-col gap-0.5 p-4 sm:p-5',
          image ? 'text-ink-inverse' : 'text-ink',
        )}
      >
        <span className="font-display text-xl font-bold uppercase leading-none tracking-tight sm:text-2xl">
          {title}
        </span>
        {detail ? (
          <span
            className={cn('data label-reg', image ? 'opacity-90' : 'text-muted')}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
