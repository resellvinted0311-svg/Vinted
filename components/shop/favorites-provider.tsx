'use client'

import * as React from 'react'
import { toggleFavorite } from '@/lib/shop/favorites'
import { useSessionBoutique } from './session-provider'

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
 *
 * ---------------------------------------------------------------------------
 * La liste ne vient plus d'une Server Action à elle
 * ---------------------------------------------------------------------------
 * Elle venait de `getFavoriteArticleIds()`, appelée ici au montage. C'était un
 * quatrième aller-retour réseau par chargement de page publique, pour une
 * session que `/api/session` venait de décoder trois lignes plus haut, et une
 * table que la même réponse pouvait lire d'un coup.
 *
 * Les identifiants voyagent donc avec l'état de session. La Server Action
 * reste en place : la page « Mes favoris » l'utilise, et c'est le seul chemin
 * possible depuis un formulaire sans JavaScript.
 */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { etat, resolu } = useSessionBoutique()
  const [ids, setIds] = React.useState<ReadonlySet<string>>(new Set())

  /*
    La liste du serveur remplace la locale, elle ne fusionne pas avec elle.

    Fusionner garderait indéfiniment un cœur coché dont le serveur a refusé la
    bascule — l'état optimiste survivrait à son démenti. Le serveur fait
    autorité ; c'est déjà la règle de `toggle` ci-dessous.

    La dépendance est la LISTE elle-même : le fournisseur la relit à chaque
    changement d'adresse, et une nouvelle réponse doit alors s'appliquer.
  */
  const favoris = etat?.favoriteIds
  React.useEffect(() => {
    if (favoris) setIds(new Set(favoris))
  }, [favoris])

  // Un échec de lecture ne bloque pas la navigation : on affiche
  // « non favori », et l'action reste possible.
  const loaded = resolu

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
