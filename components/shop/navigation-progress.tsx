'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { PendingBar } from './pending-bar'

/**
 * Le fil d'attente : un trait qui court en haut de page pendant une navigation.
 *
 * ---------------------------------------------------------------------------
 * Le problème qu'il traite, et celui qu'il ne traite pas
 * ---------------------------------------------------------------------------
 * Entre le clic et l'affichage de la page suivante, le navigateur reste sur la
 * page précédente, inerte. Pour une navigation côté client, il n'affiche même
 * pas sa propre roue de chargement : rien ne bouge. Le visiteur ne conclut pas
 * « ça charge », il conclut que son clic n'a pas été pris, et il reclique.
 *
 * Ce trait ne rend pas le serveur plus rapide d'une milliseconde. Il rend le
 * clic RÉPONDANT — une autre grandeur, et c'est celle qu'on ressent. La
 * vitesse réelle se traite ailleurs : par le nombre d'allers-retours vers la
 * base et par la distance qui nous en sépare.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas un `loading.tsx`, qui aurait été plus simple
 * ---------------------------------------------------------------------------
 * Parce qu'il casse la boutique sans JavaScript, et cela a été CONSTATÉ, pas
 * supposé : un `loading.tsx` crée une frontière Suspense, Next diffuse alors
 * la page en deux temps, et le contenu réel arrive dans un `<div hidden>` que
 * seul un script en ligne révèle. Vérifié sur le HTML servi — le squelette est
 * visible, la grille est présente mais masquée, et un navigateur sans script
 * reste sur le squelette indéfiniment.
 *
 * La boutique s'engage à fonctionner sans JavaScript : ses filtres sont un
 * formulaire GET, « voir la suite » est un vrai lien, et trois tests de bout
 * en bout le vérifient. Ce sont eux qui ont rattrapé la régression.
 *
 * Ce composant-ci n'a aucune contrepartie de ce genre : il n'introduit aucune
 * frontière de rendu, ne retarde rien, et sans JavaScript il ne fait
 * simplement rien — le navigateur reprend alors sa propre roue de chargement,
 * qui suffit puisqu'il s'agit d'une navigation complète.
 */
export function NavigationProgress() {
  const [enCours, setEnCours] = useState(false)

  /**
   * Le signal d'arrivée, et la raison pour laquelle il ne peut pas être autre
   * chose.
   *
   * Première version : on gardait l'adresse au moment du clic et un effet sans
   * dépendances la comparait après chaque rendu. Le fil s'affichait bien, et
   * ne s'effaçait JAMAIS — constaté au navigateur, pas déduit.
   *
   * La cause tient à la nature de ce composant : il vit dans la mise en page,
   * ses propriétés ne changent pas d'une page à l'autre, et React le
   * RÉUTILISE tel quel quand la page enfant change. Il n'est donc pas
   * re-rendu, et un effet « après chaque rendu » n'a plus de rendu où
   * s'accrocher.
   *
   * `usePathname` corrige cela à la racine : c'est un consommateur de
   * contexte, il provoque donc un vrai nouveau rendu à chaque changement de
   * chemin. Contrairement à `useSearchParams`, il ne fait pas basculer les
   * pages en rendu client — ce qui rouvrirait la frontière de diffusion que
   * l'on vient d'écarter pour la boutique sans JavaScript.
   */
  const chemin = usePathname()

  useEffect(() => {
    setEnCours(false)
  }, [chemin])

  useEffect(() => {
    const auClic = (event: MouseEvent) => {
      // Un clic modifié ouvre un onglet : la page courante ne bouge pas, et
      // annoncer une navigation qui n'aura pas lieu serait un mensonge.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const cible = (event.target as Element | null)?.closest('a')
      if (!(cible instanceof HTMLAnchorElement)) return

      // Téléchargement, cible externe, protocole tiers (mailto:, tel:) : le
      // document courant reste en place.
      if (cible.hasAttribute('download')) return
      if (cible.target && cible.target !== '_self') return
      if (cible.origin !== window.location.origin) return

      /**
       * Seul un changement de CHEMIN allume le fil.
       *
       * Deux cas s'écartent d'eux-mêmes, et c'est voulu : l'ancre interne, qui
       * ne fait que défiler, et le lien qui ne change que la requête —
       * « voir la suite », qui ajoute une page de résultats sous les
       * précédentes. Ce dernier est un vrai lien, mais l'arrivée s'y voit
       * immédiatement, à l'endroit où l'on regarde déjà.
       *
       * C'est aussi ce qui garde l'indicateur HONNÊTE : le signal d'arrivée
       * est le changement de chemin, donc on n'allume rien qu'il ne saura
       * éteindre. Un fil allumé sur une navigation qu'il ne sait pas suivre
       * resterait à courir jusqu'au filet de sécurité.
       */
      if (cible.pathname === window.location.pathname) return

      setEnCours(true)
    }

    /**
     * En phase de CAPTURE, et ce n'est pas un détail de style.
     *
     * `<Link>` appelle `preventDefault()` pour prendre la navigation en
     * charge côté client. Un écouteur posé sur le document en phase de
     * bouillonnement passe APRÈS lui : il trouve l'événement déjà annulé, et
     * l'écarte comme un clic sans effet. Constaté — le fil ne s'affichait
     * jamais, précisément sur les liens qu'il devait couvrir.
     *
     * La capture descend du document vers la cible : on voit donc le clic
     * avant que quiconque n'en décide. C'est aussi pourquoi il n'y a plus de
     * test sur `defaultPrevented` : à cet instant, personne n'a encore
     * tranché. Les conditions retenues portent sur le LIEN lui-même — même
     * origine, pas de cible, pas de téléchargement, pas de touche
     * modificatrice — qui suffisent à savoir si le document va changer.
     */
    document.addEventListener('click', auClic, true)
    return () => document.removeEventListener('click', auClic, true)
  }, [])

  // Filet de sécurité : une navigation abandonnée — lien mort, retour arrière
  // immédiat, erreur réseau — laisserait sinon le trait courir sans fin.
  useEffect(() => {
    if (!enCours) return
    const minuteur = window.setTimeout(() => setEnCours(false), 8_000)
    return () => window.clearTimeout(minuteur)
  }, [enCours])

  return enCours ? <PendingBar /> : null
}
