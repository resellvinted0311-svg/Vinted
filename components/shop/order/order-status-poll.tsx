'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Notice } from '@/components/ui/notice'

/**
 * L'attente du webhook, sur la page de retour de paiement.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il faut attendre quelque chose
 * ---------------------------------------------------------------------------
 * La redirection du navigateur et l'appel de Stripe à notre webhook partent en
 * même temps. La page peut donc s'afficher AVANT que la commande soit marquée
 * payée. C'est la situation normale, pas une panne.
 *
 * ---------------------------------------------------------------------------
 * Ce composant n'écrit RIEN
 * ---------------------------------------------------------------------------
 * Il interroge une adresse qui lit. Marquer une commande payée depuis la page
 * de retour est explicitement interdit par le cahier des charges, et pour une
 * raison simple : cette URL est une navigation du navigateur, que n'importe
 * qui peut ouvrir à la main.
 *
 * ---------------------------------------------------------------------------
 * Il ne dit jamais « échec »
 * ---------------------------------------------------------------------------
 * Une attente qui dure ne prouve pas qu'un paiement a échoué : elle prouve
 * qu'on ne sait pas encore. Annoncer un échec sur un paiement réussi est la
 * pire chose à faire à cet instant. Au bout du compte, le message dit ce qui
 * est vrai — la confirmation arrivera par e-mail, et la commande est
 * retrouvable par son numéro.
 *
 * Aucun bouton « j'ai payé » non plus : il ne changerait rien à l'état réel et
 * ferait croire que la personne a une part de responsabilité dans l'attente.
 */

/** Nombre de sondages avant d'arrêter. Environ deux minutes au total. */
const MAX_ATTEMPTS = 20
const INTERVAL_MS = 6000

export function OrderStatusPoll({ sessionId }: { sessionId: string }) {
  const t = useTranslations('order')
  const router = useRouter()
  const [attempts, setAttempts] = useState(0)
  const [gaveUp, setGaveUp] = useState(false)

  useEffect(() => {
    if (gaveUp) return

    const controller = new AbortController()

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/commande/${encodeURIComponent(sessionId)}/statut`,
          { signal: controller.signal, cache: 'no-store' },
        )
        if (!response.ok) throw new Error('statut indisponible')

        const body: unknown = await response.json()
        const state =
          typeof body === 'object' && body !== null && 'state' in body
            ? body.state
            : null

        if (state === 'paid' || state === 'cancelled') {
          // L'état a changé : on relit la page côté serveur plutôt que de
          // reconstruire ici ce qu'elle sait déjà afficher.
          router.refresh()
          return
        }

        const next = attempts + 1
        if (next >= MAX_ATTEMPTS) setGaveUp(true)
        else setAttempts(next)
      } catch {
        // Panne réseau ou navigation en cours : on retente, l'attente est
        // justement faite pour ça.
        const next = attempts + 1
        if (next >= MAX_ATTEMPTS) setGaveUp(true)
        else setAttempts(next)
      }
    }, INTERVAL_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [attempts, gaveUp, router, sessionId])

  if (gaveUp) {
    return (
      <Notice tone="warning" role="status">
        <p>{t('pendingTimeout')}</p>
      </Notice>
    )
  }

  return (
    <Notice tone="neutral" role="status" aria-live="polite">
      <p className="text-ink">{t('pendingPayment')}</p>
      <p className="mt-1 text-xs">{t('pendingPaymentHint')}</p>
    </Notice>
  )
}
