'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formGetUrl } from '@/lib/utils/form-url'
import { PendingBar } from './pending-bar'

/**
 * Fait naviguer un formulaire GET SANS recharger le document.
 *
 * ---------------------------------------------------------------------------
 * Le défaut qu'il corrige
 * ---------------------------------------------------------------------------
 * Cocher une taille rechargeait toute la page : le formulaire de filtres est
 * un vrai formulaire GET, et Next n'intercepte pas les soumissions natives.
 * Le navigateur repartait donc chercher le document entier — barre de
 * navigation, toile de fond, pied de page, tout — pour ne changer qu'une
 * grille de résultats. Chaque clic sur une case coûtait un chargement
 * complet, et la position de défilement était perdue au passage.
 *
 * Ici, la soumission est interceptée et confiée au routeur : seul le segment
 * de page concerné est redemandé, la mise en page reste en place, et le
 * défilement ne bouge pas (`scroll: false` — sur un panneau de filtres, on
 * regarde ses cases, pas le haut de la page).
 *
 * ---------------------------------------------------------------------------
 * Ce qu'il ne retire pas
 * ---------------------------------------------------------------------------
 * Le formulaire reste un formulaire : `method="get"`, `action` renseignée,
 * cases nommées. Sans JavaScript, cet écouteur n'est jamais posé et la
 * soumission native reprend ses droits — ce qui est vérifié de bout en bout
 * par « le formulaire de filtres fonctionne en HTML pur ».
 *
 * `push` et non `replace` : chaque changement de filtre entre dans
 * l'historique, si bien que le retour arrière défait le dernier filtre. C'est
 * ce qu'on attend d'un panneau de facettes ; `replace` rendrait le bouton
 * Retour imprévisible en renvoyant d'un coup à la page d'avant.
 */
export function FormNavigation() {
  const ancre = useRef<HTMLSpanElement>(null)
  const router = useRouter()
  const [enAttente, demarrer] = useTransition()

  useEffect(() => {
    const form = ancre.current?.closest('form')
    if (!form) return

    const onSubmit = (event: Event) => {
      // Un autre gestionnaire a pu décider que cette soumission n'a pas lieu
      // d'être — la recherche le fait quand une suggestion est retenue.
      if (event.defaultPrevented) return

      event.preventDefault()

      const action = form.getAttribute('action') ?? window.location.pathname
      const url = formGetUrl(action, new FormData(form))

      demarrer(() => {
        router.push(url, { scroll: false })
      })
    }

    form.addEventListener('submit', onSubmit)
    return () => form.removeEventListener('submit', onSubmit)
  }, [router])

  return (
    <>
      <span ref={ancre} hidden />
      {/*
        Le trait d'attente, parce que rien d'autre ne bouge.

        Un changement de filtre ne change pas le chemin : l'indicateur de
        navigation, qui s'accroche au chemin, reste donc éteint — à raison, il
        ne saurait pas quand s'arrêter. `useTransition`, lui, connaît
        exactement la durée de CETTE attente.
      */}
      {enAttente ? <PendingBar /> : null}
    </>
  )
}
