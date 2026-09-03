import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import type { FacetEntry } from '@/lib/db/queries/articles'
import { Reveal } from '@/components/motion/reveal'

/**
 * Un raccourci vers une tranche du catalogue, avec son effectif.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi l'effectif est affiché, et pourquoi il n'est jamais nul
 * ---------------------------------------------------------------------------
 * « Taille S » ne dit pas s'il y a deux pièces ou cent quarante. Le nombre est
 * ce qui transforme un raccourci en promesse tenable : le visiteur sait où le
 * stock est fourni avant de cliquer, donc il ne tombe pas sur une grille vide.
 *
 * Les entrées viennent des FACETTES du catalogue, qui ne renvoient que les
 * valeurs ayant au moins une pièce disponible. Une taille épuisée disparaît
 * donc d'elle-même, au lieu d'être affichée grisée : un raccourci grisé occupe
 * la même place qu'un raccourci utile et n'en fait pas le travail.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ces liens portent le paramètre du catalogue
 * ---------------------------------------------------------------------------
 * Ils pointent vers `/catalogue?taille=S`, pas vers une page dédiée. Le filtre
 * vit dans l'URL : la page est partageable, indexable, et le retour arrière la
 * restitue. Fabriquer une seconde route pour le même résultat créerait deux
 * adresses pour un même contenu, ce que le référencement pénalise et ce que la
 * navigation ne pardonne pas.
 */
export async function ShortcutGrid({
  title,
  param,
  entries,
  limit,
}: {
  title: string
  /** Le nom du paramètre attendu par le catalogue : `taille`, `cat`… */
  param: string
  entries: readonly FacetEntry[]
  /**
   * Combien de raccourcis au plus.
   *
   * Les facettes sont triées par effectif décroissant : la limite retient donc
   * les tranches où le stock est le plus fourni, ce qui est exactement ce
   * qu'un raccourci doit montrer. Le reste n'est pas perdu — le panneau de
   * filtres du catalogue les porte toutes, et le lien de fin y mène.
   */
  limit: number
}) {
  const t = await getTranslations('home')

  // Rien à montrer : la section n'existe pas plutôt que d'afficher un titre
  // au-dessus du vide. Cas réel au lancement, sur un catalogue encore mince.
  if (entries.length === 0) return null

  const shown = entries.slice(0, limit)

  return (
    <section className="mx-auto max-w-[80rem] px-4 py-10 sm:px-6 sm:py-14">
      <Reveal>
        <div className="ruled-signature flex flex-wrap items-end justify-between gap-4 pb-4">
          <h2 className="text-gradient type-section font-display font-bold uppercase">
            {title}
          </h2>

          {entries.length > shown.length ? (
            <Link
              href="/catalogue"
              className="label-reg pb-1 text-muted underline underline-offset-4 hover:text-ink"
            >
              {t('seeAll')}
            </Link>
          ) : null}
        </div>
      </Reveal>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((entry, index) => (
          <Reveal key={entry.value} delay={Math.min(index, 6) * 40}>
            <li>
              <Link
                href={{ pathname: '/catalogue', query: { [param]: entry.value } }}
                className="lift flex min-h-[72px] flex-col justify-center gap-1 rounded-card ruled bg-paper-raised px-4 py-3"
              >
                <span className="font-display text-lg font-bold uppercase leading-none tracking-tight text-ink">
                  {entry.label}
                </span>
                <span className="data label-reg text-muted">
                  {t('pieceCount', { count: entry.count })}
                </span>
              </Link>
            </li>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
