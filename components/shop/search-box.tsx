'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils/cn'
import { FormNavigation } from './form-navigation'

interface Suggestion {
  type: 'article' | 'brand' | 'category'
  label: string
  href: string
  detail?: string
}

/**
 * Recherche avec autocomplétion.
 *
 * Le formulaire fonctionne sans JavaScript : il pointe vers /catalogue?q=…,
 * qui rend les résultats côté serveur. L'autocomplétion n'est qu'une couche
 * de confort par-dessus.
 *
 * Le motif ARIA est celui d'une combobox : la liste est annoncée, les flèches
 * la parcourent, Échap la referme.
 *
 * Le champ vit dans la BARRE DE NAVIGATION, derrière la loupe, et nulle part
 * ailleurs — voir `header-search.tsx`. Il ne doit exister qu'à UN endroit du
 * document : deux exemplaires produiraient deux combobox portant le même
 * intitulé, donc deux fois la même commande annoncée aux lecteurs d'écran.
 *
 * Il a vécu dans la vue catalogue entre-temps, pour ne pas encombrer les pages
 * où l'on ne cherche pas. Cette raison est tombée le jour où la barre a reçu
 * une loupe : le champ ne s'y déploie que si on le demande.
 */
export function SearchBox({
  className,
  /**
   * La requête déjà appliquée aux résultats affichés.
   *
   * Sans elle, le champ se rouvre vide au-dessus d'une grille filtrée : on lit
   * « Résultats pour chemise » et on ne peut plus corriger « chemise » sans le
   * retaper en entier. Le champ doit dire ce qui est cherché, pas seulement
   * servir à chercher.
   */
  valeurInitiale = '',
}: {
  className?: string
  valeurInitiale?: string
}) {
  const t = useTranslations('search')
  const locale = useLocale()
  const router = useRouter()

  const listId = useId()
  const [query, setQuery] = useState(valeurInitiale)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()

    // `open` fait partie de la condition, et pas seulement de l'affichage.
    //
    // Le champ s'ouvre désormais prérempli de la requête en cours : sans ce
    // garde, chaque affichage de /catalogue?q=… déclencherait une recherche
    // plein texte au montage, pour une liste que personne n'a demandé à voir.
    // C'est la page la plus visitée du site.
    if (!open || trimmed.length < 2) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    // Temporisation : sans elle, chaque frappe déclencherait une requête
    // plein texte.
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&locale=${locale}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { suggestions: Suggestion[] } | null) => {
          if (data) {
            setSuggestions(data.suggestions)
            setActive(-1)
          }
        })
        .catch(() => undefined)
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, locale, open])

  // Ferme la liste au clic à l'extérieur.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const go = (suggestion: Suggestion): void => {
    setOpen(false)
    setQuery('')
    router.push(suggestion.href)
  }

  const showList = open && suggestions.length > 0

  return (
    <div ref={container} className={cn('relative', className)}>
      <form action={`/${locale}/catalogue`} method="get" role="search">
        {/*
          Valider la recherche rechargeait tout le document, comme les
          filtres. `FormNavigation` la fait passer par le routeur, sans
          retirer au formulaire sa capacité à fonctionner sans JavaScript.
        */}
        <FormNavigation />
        <label htmlFor={`${listId}-input`} className="sr-only">
          {t('label')}
        </label>

        <div className="flex">
          <input
            id={`${listId}-input`}
            name="q"
            type="search"
            autoComplete="off"
            value={query}
            placeholder={t('placeholder')}
            role="combobox"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              active >= 0 ? `${listId}-option-${active}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false)
                return
              }
              if (!showList) return

              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => (index + 1) % suggestions.length)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) =>
                  index <= 0 ? suggestions.length - 1 : index - 1,
                )
              } else if (event.key === 'Enter' && active >= 0) {
                const suggestion = suggestions[active]
                if (suggestion) {
                  event.preventDefault()
                  go(suggestion)
                }
              }
            }}
            className="min-h-[44px] w-full rounded-input border-[1.5px] border-rule bg-surface px-3 text-base text-ink placeholder:text-muted"
          />

          <button type="submit" className="sr-only">
            {t('submit')}
          </button>
        </div>
      </form>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('label')}
          className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-card ruled bg-surface shadow-[4px_4px_0_var(--rule)]"
        >
          {suggestions.map((suggestion, index) => (
            /*
              L'OPTION EST LA LIGNE ELLE-MÊME. Elle contenait un `<button>`,
              et c'était deux défauts en un.

              Un élément `role="option"` ne doit pas contenir de descendant
              interactif : le calcul de son nom et de son rôle devient
              indéfini, et le lecteur d'écran n'annonce plus de façon fiable
              ce qui est sélectionné.

              Surtout, un bouton est nativement focalisable. La tabulation
              depuis le champ parcourait donc les suggestions une par une, au
              lieu de sortir de la zone de recherche — alors que le motif
              implémenté juste au-dessus est l'autre, le bon : le focus reste
              dans le champ, les flèches déplacent la sélection, et
              `aria-activedescendant` dit laquelle est active. Les deux
              mécanismes se contredisaient.

              La ligne garde son `onClick` : cliquer une option n'a jamais eu
              besoin d'un bouton, et le clavier passe par le champ.
            */
            <li
              key={`${suggestion.type}-${suggestion.href}`}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(suggestion)}
              className={cn(
                'flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 text-left text-base',
                index === active ? 'bg-paper-raised' : 'bg-surface',
              )}
            >
              <span className="truncate text-ink">{suggestion.label}</span>
              <span className="label-reg shrink-0 text-muted">
                {suggestion.detail ?? ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
