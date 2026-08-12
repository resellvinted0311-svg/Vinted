'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/lib/i18n/navigation'
import { cn } from '@/lib/utils/cn'

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
 */
export function SearchBox({ className }: { className?: string }) {
  const t = useTranslations('search')
  const locale = useLocale()
  const router = useRouter()

  const listId = useId()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    // Temporisation : sans elle, chaque frappe déclencherait une requête
    // plein texte.
    const timer = setTimeout(() => {
      fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&locale=${locale}`,
        { signal: controller.signal },
      )
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
  }, [query, locale])

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
            className="min-h-[44px] w-full rounded-input border border-sand-strong bg-surface px-3 text-base text-ink placeholder:text-muted"
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
          className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-card border border-sand-strong bg-surface"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.type}-${suggestion.href}`}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === active}
            >
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(suggestion)}
                className={cn(
                  'flex w-full min-h-[44px] items-center justify-between gap-3 px-3 text-left text-base',
                  index === active ? 'bg-paper-raised' : 'bg-surface',
                )}
              >
                <span className="truncate text-ink">{suggestion.label}</span>
                <span className="shrink-0 text-xs text-muted">
                  {suggestion.detail ?? ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
