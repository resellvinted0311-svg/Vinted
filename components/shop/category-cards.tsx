import { getTranslations } from 'next-intl/server'
import type { FacetEntry } from '@/lib/db/queries/articles'
import { Reveal } from '@/components/motion/reveal'
import { PictureCard } from './picture-card'

/**
 * Les sous-catégories d'un univers, en cartes illustrées.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi vers `/c/<slug>` et non vers `/catalogue?cat=<slug>`
 * ---------------------------------------------------------------------------
 * Les deux adresses servent exactement le même contenu, et c'est justement le
 * problème : `shortcut-grid.tsx` explique en commentaire qu'il faut « éviter
 * deux adresses pour un même contenu, ce que le référencement pénalise » — et
 * pointe pourtant vers la forme paramétrée, pendant que `/c/<slug>` est la
 * seule des deux à porter une URL canonique propre et un fil d'Ariane.
 *
 * Conséquence mesurable : les pages de catégorie n'avaient AUCUN lien entrant
 * depuis le site. Elles existaient, elles étaient indexables, et rien n'y
 * menait. Ces cartes sont désormais leur entrée.
 *
 * ---------------------------------------------------------------------------
 * L'univers ne se perd pas au clic
 * ---------------------------------------------------------------------------
 * Le lien emporte le filtre d'univers en paramètre. Sans lui, une femme qui
 * clique « Chaussures » depuis la vitrine Femme retomberait sur toutes les
 * chaussures du magasin — l'inverse exact de ce qu'elle vient de demander.
 */
export async function CategoryCards({
  title,
  entries,
  covers,
  audiences,
}: {
  title: string
  entries: readonly FacetEntry[]
  /** Une photographie par catégorie, quand la catégorie en a une. */
  covers: Map<string, { url: string; width: number; height: number }>
  /** L'univers courant, reporté sur chaque lien. */
  audiences: readonly string[]
}) {
  const t = await getTranslations('home')

  if (entries.length === 0) return null

  const univers = audiences.map((valeur) => `univers=${encodeURIComponent(valeur)}`)

  return (
    <section className="mx-auto max-w-[80rem] px-4 py-10 sm:px-6 sm:py-14">
      <Reveal>
        <div className="ruled-signature pb-4">
          <h2 className="text-gradient type-section font-display font-bold uppercase">
            {title}
          </h2>
        </div>
      </Reveal>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
        {entries.map((entry, index) => (
          <Reveal key={entry.value} delay={Math.min(index, 6) * 40}>
            <li>
              <PictureCard
                href={`/c/${entry.value}?${univers.join('&')}`}
                title={entry.label}
                detail={t('pieceCount', { count: entry.count })}
                image={covers.get(entry.value) ?? null}
                ratio="aspect-[4/5]"
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              />
            </li>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
