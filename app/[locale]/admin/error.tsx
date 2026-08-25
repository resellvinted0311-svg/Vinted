'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'

/**
 * Frontière d'erreur de la régie.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle existe séparément
 * ---------------------------------------------------------------------------
 * La seule autre du projet vit sous `(shop)/commande` : elle ne couvre pas ce
 * segment. Sans ce fichier, une base indisponible ou un défaut inattendu
 * tomberait sur l'écran d'erreur par défaut de Next — une page cassée, avec
 * une trace en développement.
 *
 * Le contrôle du rôle, lui, ne passe PAS par ici : le layout traite
 * `AuthorizationError` lui-même, par une redirection ou un `notFound()`.
 * Laisser une erreur d'autorisation remonter jusqu'à une frontière d'erreur
 * afficherait « quelque chose s'est mal passé » là où la bonne réponse est
 * « cette page n'existe pas ».
 *
 * ---------------------------------------------------------------------------
 * Ce qui est journalisé, et ce qui ne l'est pas
 * ---------------------------------------------------------------------------
 * Le seul `digest` — l'empreinte que Next attribue à l'erreur côté serveur.
 * Elle ne contient aucune donnée personnelle et permet de retrouver la trace
 * complète dans les journaux du serveur. Le message, lui, peut porter un
 * fragment de requête ou une valeur : il ne sort pas.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (error.digest) console.error('[admin] Erreur de rendu.', error.digest)
  }, [error.digest])

  return (
    <div className="mx-auto w-full max-w-[40rem] px-4 pb-24 pt-16 sm:px-6">
      <Notice tone="danger" role="alert" title="La régie n’a pas pu s’afficher">
        <p>
          Rien n’a été modifié. Si l’erreur persiste, la référence ci-dessous
          permet de la retrouver dans les journaux.
        </p>
        {error.digest ? (
          <p className="data mt-2 text-xs text-muted">{error.digest}</p>
        ) : null}
      </Notice>

      <Button onClick={reset} variant="outline" className="mt-6">
        Réessayer
      </Button>
    </div>
  )
}
