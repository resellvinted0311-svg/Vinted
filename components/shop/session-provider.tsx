'use client'

import * as React from 'react'
import { usePathname } from '@/lib/i18n/navigation'

/**
 * L'état de session, lu UNE fois pour toute la page.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fournisseur supprime
 * ---------------------------------------------------------------------------
 * Trois composants de l'en-tête — l'entrée « compte », le compteur du panier,
 * le compteur des favoris — appelaient chacun `/api/session` de leur côté,
 * dans leur propre `useEffect`. Le fournisseur de favoris, lui, appelait une
 * Server Action pour la liste des identifiants.
 *
 * Soit QUATRE allers-retours au chargement de chaque page publique, pour la
 * même session, décodée quatre fois, avec autant de requêtes en base
 * derrière. Deux d'entre eux se répétaient de surcroît à chaque navigation
 * côté client.
 *
 * Le navigateur ne les regroupe pas : trois `fetch` vers la même adresse
 * partis dans la même milliseconde sont trois requêtes, la réponse étant
 * `no-store`. Et rien ne le signalait — l'en-tête s'affichait correctement, la
 * page était rapide, le coût était entièrement en base de données.
 *
 * Une seule lecture les sert tous les quatre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la lecture est REFAITE à chaque changement d'adresse
 * ---------------------------------------------------------------------------
 * Ce fournisseur vit dans la coque de la boutique : il survit aux navigations
 * côté client. Avec une dépendance vide, il resterait sur l'état observé au
 * tout premier rendu — après une connexion, la barre continuerait d'afficher
 * « Se connecter » jusqu'au prochain rechargement complet.
 *
 * C'était déjà le comportement de deux des trois composants ; le compteur du
 * panier, lui, ne se relisait qu'au montage et compensait par un événement.
 * Les deux mécanismes coexistent : l'événement reste plus précis — il porte le
 * nombre que le serveur vient de compter — la relecture rattrape le reste.
 *
 * ---------------------------------------------------------------------------
 * Ce qui n'est PAS ici
 * ---------------------------------------------------------------------------
 * Aucun rendu ne dépend de cet état côté serveur, et c'est le point. Lire la
 * session pendant le rendu ferait sortir du cache statique l'accueil, le
 * catalogue et les fiches article — les pages qui portent le référencement et
 * les cibles Core Web Vitals.
 */
export interface EtatSession {
  signedIn: boolean
  firstName: string | null
  role: string | null
  cartCount: number
  favoriteCount: number
  favoriteIds: string[]
}

interface ValeurContexte {
  /** `null` tant que la réponse n'est pas arrivée : évite un état faux. */
  etat: EtatSession | null
  /** Vrai dès que la première réponse est traitée, succès ou échec. */
  resolu: boolean
}

const Contexte = React.createContext<ValeurContexte | null>(null)

export function useSessionBoutique(): ValeurContexte {
  const valeur = React.useContext(Contexte)
  if (!valeur) {
    throw new Error(
      'useSessionBoutique doit être appelé dans <SessionProvider>.',
    )
  }
  return valeur
}

/** Lecture défensive : la réponse vient du réseau, pas d'un type. */
function lireEtat(corps: unknown): EtatSession | null {
  if (typeof corps !== 'object' || corps === null) return null
  const brut = corps as Record<string, unknown>

  if (typeof brut.signedIn !== 'boolean') return null

  return {
    signedIn: brut.signedIn,
    firstName: typeof brut.firstName === 'string' ? brut.firstName : null,
    role: typeof brut.role === 'string' ? brut.role : null,
    cartCount: typeof brut.cartCount === 'number' ? brut.cartCount : 0,
    favoriteCount:
      typeof brut.favoriteCount === 'number' ? brut.favoriteCount : 0,
    favoriteIds: Array.isArray(brut.favoriteIds)
      ? brut.favoriteIds.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [etat, setEtat] = React.useState<EtatSession | null>(null)
  const [resolu, setResolu] = React.useState(false)

  React.useEffect(() => {
    const controleur = new AbortController()

    async function charger() {
      try {
        const reponse = await fetch('/api/session', {
          signal: controleur.signal,
          cache: 'no-store',
        })
        if (!reponse.ok) {
          // Un refus — plafond de débit atteint, panne — ne doit pas laisser
          // l'en-tête en attente indéfinie : on le déclare résolu, et chaque
          // composant décide de ce qu'il montre sans état connu.
          setResolu(true)
          return
        }
        const lu = lireEtat(await reponse.json())
        if (lu) setEtat(lu)
        setResolu(true)
      } catch {
        // Panne réseau ou navigation en cours : on retombe sur l'état
        // déconnecté, qui reste utilisable.
        if (!controleur.signal.aborted) setResolu(true)
      }
    }

    void charger()
    return () => controleur.abort()
  }, [pathname])

  const valeur = React.useMemo(() => ({ etat, resolu }), [etat, resolu])

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}
