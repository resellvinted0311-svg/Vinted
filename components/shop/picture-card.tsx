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
 * Rien ne couvre la photographie ; ce qui protège l'intitulé est sur l'encre
 * ---------------------------------------------------------------------------
 * Sur le lavis, l'encre passe à plus de douze contre un. Sur une photographie
 * inconnue — un mur clair, un vêtement blanc, une porte sombre — elle peut
 * tomber à un contre un, et l'intitulé disparaît. Il faut donc bien quelque
 * chose ; la question est seulement OÙ on le met.
 *
 * Un dégradé le mettait sur l'image, et éteignait la moitié basse de chaque
 * carte — exactement la part où la photo montre le vêtement. L'ombre portée le
 * met sur les lettres : le halo se limite au contour du glyphe, la
 * photographie n'est ni assombrie ni éclaircie, et le contraste devient celui
 * du blanc contre le halo.
 *
 * Le détail du réglage, et pourquoi l'encre est passée au blanc en dur, est
 * expliqué au point d'application plus bas.
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

      <span
        className={cn(
          'relative mt-auto flex w-full flex-col gap-0.5 p-4 sm:p-5',
          image ? 'text-white' : 'text-ink',
        )}
        /*
          Pas de voile sur la photographie — c'est une demande explicite, et le
          reproche était juste : le dégradé couvrait la moitié basse de chaque
          carte, c'est-à-dire l'endroit où la photo montrait le vêtement.

          Le problème qu'il réglait reste entier, et il est plus dur ici que sur
          le bandeau : une carte de rayon prend n'importe quelle photographie
          d'article, cadrée et éclairée de n'importe quelle façon. On ne sait
          donc RIEN du fond derrière l'intitulé.

          Deux changements le règlent sans toucher à l'image :

            - l'encre passe au blanc. Elle était sombre parce que le voile,
              lui, était clair (`--ink` en thème sombre est presque blanc) :
              sans le voile, cette encre-là se posait sur la photo brute, et
              une porte grise sombre l'effaçait complètement.

            - une ombre portée sur les LETTRES. Elle n'assombrit pas la
              photographie : elle pose un halo dans le contour du glyphe, si
              bien que le contraste devient celui du blanc contre le halo — et
              non plus celui du blanc contre ce qu'il y a derrière.

          Le blanc est écrit en dur, et non pris dans les jetons : il ne doit
          PAS suivre le thème. Le fond n'est pas la page, c'est une
          photographie — elle ne s'éclaircit pas quand la personne passe en
          thème clair, et une encre qui suivrait le thème deviendrait sombre
          sur une image restée sombre.
        */
        style={
          image
            ? {
                textShadow:
                  '0 1px 2px rgba(11,17,28,0.92), 0 2px 14px rgba(11,17,28,0.78)',
              }
            : undefined
        }
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
