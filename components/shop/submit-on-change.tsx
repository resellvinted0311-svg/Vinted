'use client'

import { useEffect, useRef } from 'react'

/**
 * Amélioration progressive du panneau de filtres.
 *
 * Sans JavaScript, le formulaire fonctionne déjà : on coche des cases, on
 * valide, la page se recharge avec les bons paramètres. Ce composant ne fait
 * qu'ajouter le confort — soumission automatique au changement — sans que
 * quoi que ce soit n'en dépende.
 *
 * Il masque aussi le bouton « Appliquer », devenu redondant, tout en le
 * laissant atteignable au clavier : quelqu'un qui navigue à la tabulation
 * doit pouvoir valider explicitement.
 */
export function SubmitOnChange() {
  const anchor = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const form = anchor.current?.closest('form')
    if (!form) return

    const submitButton = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    submitButton?.classList.add('sr-only')

    let timer: ReturnType<typeof setTimeout> | undefined

    const submit = (): void => {
      form.requestSubmit()
    }

    const onChange = (event: Event): void => {
      const target = event.target as HTMLElement | null
      // Les champs de prix sont temporisés : soumettre à chaque frappe
      // relancerait une requête par chiffre saisi.
      if (target instanceof HTMLInputElement && target.type === 'number') {
        if (timer) clearTimeout(timer)
        timer = setTimeout(submit, 600)
        return
      }
      submit()
    }

    form.addEventListener('change', onChange)
    form.addEventListener('input', onChange)

    return () => {
      form.removeEventListener('change', onChange)
      form.removeEventListener('input', onChange)
      submitButton?.classList.remove('sr-only')
      if (timer) clearTimeout(timer)
    }
  }, [])

  return <span ref={anchor} hidden />
}
