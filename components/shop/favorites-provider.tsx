'use client'

import * as React from 'react'
import { getFavoriteArticleIds, toggleFavorite } from '@/lib/shop/favorites'

interface FavoritesContextValue {
  ids: ReadonlySet<string>
  /** `null` tant que la liste n'est pas connue : évite un état faux. */
  loaded: boolean
  toggle: (articleId: string) => Promise<boolean>
}

const FavoritesContext = React.createContext<FavoritesContextValue | null>(null)

export function useFavorites(): FavoritesContextValue {
  const ctx = React.useContext(FavoritesContext)
  if (!ctx) {
    throw new Error('useFavorites doit être appelé dans <FavoritesProvider>.')
  }
  return ctx
}

/**
 * Favoris, résolus côté client.
 *
 * Comme pour la session, les lire pendant le rendu ferait sortir le catalogue
 * du cache statique — or ce sont précisément les pages indexées et soumises
 * aux cibles Core Web Vitals.
 *
 * Une seule requête ramène l'ensemble des identifiants : chaque vignette lit
 * ensuite ce Set, plutôt que d'interroger le serveur pour elle-même.
 */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = React.useState<ReadonlySet<string>>(new Set())
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    getFavoriteArticleIds()
      .then((list) => {
        if (!cancelled) {
          setIds(new Set(list))
          setLoaded(true)
        }
      })
      .catch(() => {
        // Un échec ne doit pas bloquer la navigation : on affiche
        // « non favori », l'action reste possible.
        if (!cancelled) setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const toggle = React.useCallback(async (articleId: string) => {
    // Mise à jour optimiste : l'état bascule immédiatement, puis on
    // s'aligne sur la réponse du serveur, qui fait autorité.
    let optimistic = false
    setIds((current) => {
      const next = new Set(current)
      if (next.has(articleId)) {
        next.delete(articleId)
        optimistic = false
      } else {
        next.add(articleId)
        optimistic = true
      }
      return next
    })

    try {
      const result = await toggleFavorite(articleId)

      setIds((current) => {
        const next = new Set(current)
        if (result.ok && result.isFavorite) next.add(articleId)
        else next.delete(articleId)
        return next
      })

      return result.ok ? result.isFavorite : !optimistic
    } catch {
      // Rétablit l'état antérieur si l'appel a échoué.
      setIds((current) => {
        const next = new Set(current)
        if (optimistic) next.delete(articleId)
        else next.add(articleId)
        return next
      })
      return !optimistic
    }
  }, [])

  const value = React.useMemo(
    () => ({ ids, loaded, toggle }),
    [ids, loaded, toggle],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}
