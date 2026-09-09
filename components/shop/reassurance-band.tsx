import { getTranslations } from 'next-intl/server'
import { Surpiqure } from '@/components/shop/surpiqure'

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
    <section className="gradient-accent relative ruled-t ruled-b text-ink-inverse">
      {/*
        Les deux coutures sont posées à l'intérieur des bords, à la distance
        où tombe une surpiqûre de vêtement — assez près du bord pour dire
        qu'elle le retient, assez loin pour ne pas se confondre avec lui.

        Elles ne rentrent pas dans le flux : le bandeau garde exactement la
        hauteur de son texte, et la couture ne la modifie pas.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[9px]"
      >
        <Surpiqure
          forme="ligne"
          ton="clair"
          retrait={0}
          graine={17}
          desordre={0.55}
          hauteurDeReference={9}
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[9px]"
      >
        <Surpiqure
          forme="ligne"
          ton="clair"
          retrait={0}
          graine={83}
          desordre={0.55}
          hauteurDeReference={9}
        />
      </div>

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
