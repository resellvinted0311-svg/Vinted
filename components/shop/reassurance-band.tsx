import { getTranslations } from 'next-intl/server'

/**
 * Le bandeau de réassurance, sous le visuel d'arrivée.
 *
 * ---------------------------------------------------------------------------
 * Trois faits, et ils ne défilent plus
 * ---------------------------------------------------------------------------
 * Ce bandeau remplace la bande défilante qui occupait la même place. Le
 * remplacement corrige un défaut d'accessibilité RÉEL et déjà en ligne :
 * l'animation tournait en boucle infinie sur quarante-six secondes, et sa
 * seule pause était le survol de la souris — donc rien au clavier, rien au
 * tactile, aucune commande visible. Le critère WCAG 2.2.2 impose de pouvoir
 * mettre en pause, arrêter ou masquer tout mouvement automatique qui dure plus
 * de cinq secondes. C'est un critère de niveau A, c'est-à-dire en deçà du
 * niveau AA que la boutique s'est engagée à tenir.
 *
 * Trois faits courts tiennent sur une ligne. Il n'y avait donc rien à faire
 * défiler : le mouvement ne servait qu'à lui-même.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces trois faits ont en commun
 * ---------------------------------------------------------------------------
 * Ils sont vérifiables, et ils engagent. « Un exemplaire de chaque pièce » est
 * une propriété du stock. Le délai d'expédition et le délai de rétractation
 * sont des engagements contractuels : ils sont repris À L'IDENTIQUE de ce que
 * la boutique affirme déjà ailleurs — la page « comment ça marche » pour
 * l'expédition, le colophon pour la rétractation. Les réécrire ici, même en
 * mieux, créerait deux versions d'une même promesse, et c'est la plus
 * ambitieuse des deux qui engagerait.
 */
export async function ReassuranceBand() {
  const t = await getTranslations('home')

  const faits = [
    t('claimUnique'),
    t('claimShipped'),
    t('claimReturn'),
  ] as const

  return (
    <section className="gradient-accent ruled-t ruled-b text-ink-inverse">
      <ul className="mx-auto flex max-w-[80rem] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        {faits.map((fait) => (
          <li key={fait} className="label-reg">
            {fait}
          </li>
        ))}
      </ul>
    </section>
  )
}
