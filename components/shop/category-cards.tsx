import type { ShowcaseCategory } from '@/lib/db/queries/taxonomy'
import { Reveal } from '@/components/motion/reveal'
import { PictureCard } from './picture-card'

/**
 * Les rayons d'un univers, en cartes illustrées.
 *
 * ---------------------------------------------------------------------------
 * La liste vient de l'ARBRE des catégories, pas des pièces en vente
 * ---------------------------------------------------------------------------
 * Elle venait des facettes, c'est-à-dire du stock. Une boutique dont rien
 * n'est encore rangé n'avait donc aucune carte, et la page s'ouvrait vide :
 * la mise en page demandée n'existait qu'en théorie.
 *
 * Ces cartes sont les rayons du magasin. Un rayon reste accroché quand
 * l'étagère est vide — c'est même à ce moment-là qu'il sert le plus, puisqu'il
 * dit ce que la boutique fera. La liste est donc stable, et les photographies
 * viendront s'y poser plus tard sans que rien d'autre ne bouge.
 *
 * ---------------------------------------------------------------------------
 * Juste l'intitulé, aucun effectif
 * ---------------------------------------------------------------------------
 * Un rayon vide afficherait « aucune pièce » sur chaque carte, et une grille de
 * quinze cartes répétant ce constat est un mur de refus. Le nombre se lit à
 * l'arrivée, où il est utile ; ici on annonce une entrée.
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
 * Le filtre d'univers n'est emporté QUE s'il trie quelque chose
 * ---------------------------------------------------------------------------
 * Sans lui, une femme qui clique « Chaussures » depuis la vitrine Femme
 * retomberait sur toutes les chaussures du magasin — l'inverse de ce qu'elle
 * vient de demander. Mais tant qu'aucune pièce n'est rangée d'un côté ou de
 * l'autre, ce même filtre ne trie rien : il vide. La carte mènerait alors à
 * une grille déserte alors que le rayon est plein.
 *
 * Le filtre est donc posé par la page appelante, qui sait s'il y a quelque
 * chose à trier. Il s'allumera tout seul dès que le rangement commencera,
 * sans qu'aucune ligne ne change ici.
 */
export function CategoryCards({
  title,
  entries,
  covers,
  audiences,
}: {
  title: string
  /** Les rayons, tels que la taxonomie les définit. */
  entries: readonly ShowcaseCategory[]
  /** Une photographie par rayon, quand le rayon en a une. */
  covers: Map<string, { url: string; width: number; height: number }>
  /**
   * L'univers à reporter sur chaque lien — vide quand il ne trierait rien.
   * Voir le raisonnement ci-dessus.
   */
  audiences: readonly string[]
}) {
  // Une taxonomie vide n'arrive que sur une base non semée : il n'y aurait
  // alors aucun rayon à nommer. Ce n'est pas la garde qui masquait la section.
  if (entries.length === 0) return null

  const univers = audiences
    .map((valeur) => `univers=${encodeURIComponent(valeur)}`)
    .join('&')

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
          <Reveal key={entry.slug} delay={Math.min(index, 6) * 40}>
            <li>
              <PictureCard
                href={univers === '' ? `/c/${entry.slug}` : `/c/${entry.slug}?${univers}`}
                title={entry.name}
                image={covers.get(entry.slug) ?? null}
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
