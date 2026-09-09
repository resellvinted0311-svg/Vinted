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
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce bandeau est SURPIQUÉ
 * ---------------------------------------------------------------------------
 * Parce que c'est ce qu'il est, dans le vocabulaire du vêtement : un panneau
 * clair rapporté sur de l'indigo. Sur un jean, un empiècement de cette sorte
 * n'est jamais posé — il est COUSU, et la couture se voit sur ses deux bords.
 * Sans elle, la bande flotte au milieu de la toile comme un aplat qu'on aurait
 * oublié de fixer.
 *
 * Le fil est le même que celui de la barre de navigation, mais il n'y joue pas
 * le même rôle. Sur l'indigo, un fil blanc porte le dessin à lui seul. Ici, la
 * toile est presque aussi claire que lui : ce qui se voit, c'est le RELIEF —
 * le pli, les trous d'aiguille, l'ombre portée. C'est une couture ton sur ton,
 * et elle se lit exactement comme sur un vêtement.
 *
 * Deux graines différentes pour les deux lignes : à graine égale, elles
 * seraient superposables au point près, et deux coutures parallèles identiques
 * se repèrent immédiatement comme un décalque.
 */
export async function ReassuranceBand() {
  const t = await getTranslations('home')

  const faits = [t('claimUnique'), t('claimShipped'), t('claimReturn')] as const

  return (
    <section className="gradient-accent ruled-t ruled-b text-ink-inverse">
      {/*
        LES DEUX COUTURES SONT RETIRÉES — demande de la boutique.

        Elles longeaient les bords haut et bas du bandeau, à la distance où
        tombe une surpiqûre de vêtement. Posées juste sous la barre de
        navigation, qui en portait une elle aussi, elles faisaient trois lignes
        pointillées dans les cent premiers pixels de la vitrine : le motif
        cessait d'être une signature pour devenir un bruit.

        Les bords ne disparaissent pas pour autant : `ruled-t` et `ruled-b`
        tiennent toujours les deux arêtes du bandeau, et le lavis d'accent le
        détache du blanc de la page.

        `relative` est parti avec elles : il n'existait que pour leur servir de
        repère de positionnement. Un contexte de positionnement laissé derrière
        soi ne se voit jamais — jusqu'au jour où un élément posé en absolu se
        cale dessus au lieu de la page, et où l'on cherche pourquoi.
      */}
      <ul className="mx-auto flex max-w-[var(--colonne)] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        {faits.map((fait) => (
          <li key={fait} className="label-reg">
            {fait}
          </li>
        ))}
      </ul>
    </section>
  )
}
