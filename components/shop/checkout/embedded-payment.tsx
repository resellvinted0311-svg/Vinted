'use client'

import { useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js'
import { useTranslations } from 'next-intl'
import { Notice } from '@/components/ui/notice'

/**
 * Le cadre de saisie de carte, servi par Stripe.
 *
 * ---------------------------------------------------------------------------
 * Le SEUL fichier du dépôt qui importe `@stripe/*`
 * ---------------------------------------------------------------------------
 * Un test le vérifie. La raison n'est pas la propreté : ces paquets tirent un
 * script tiers, et un import ajouté ailleurs — dans un composant partagé, dans
 * une mise en page — le ferait charger sur des pages où personne ne paie,
 * avant tout consentement, sur des pages publiques prérendues.
 *
 * ---------------------------------------------------------------------------
 * Aucun numéro de carte ne traverse ce serveur
 * ---------------------------------------------------------------------------
 * Le cadre est un contexte servi par Stripe. Nous lui remettons un secret de
 * session ; la saisie ne passe jamais par notre code, ni par notre base.
 *
 * ---------------------------------------------------------------------------
 * Rien n'est marqué payé ici
 * ---------------------------------------------------------------------------
 * À la fin, Stripe redirige vers la page de retour. Cette page LIT l'état
 * écrit par le webhook signé, et ne l'écrit jamais : la redirection est une
 * simple navigation du navigateur, que n'importe qui peut déclencher à la
 * main.
 */

/**
 * Chargé une seule fois par page, pas à chaque rendu.
 *
 * `loadStripe` insère le script de Stripe dans le document. L'appeler dans le
 * corps du composant le relancerait à chaque rendu — et le composant se rend à
 * chaque frappe du formulaire au-dessus.
 */
function useStripePromise(publishableKey: string | null) {
  return useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  )
}

export function EmbeddedPayment({
  clientSecret,
  publishableKey,
}: {
  clientSecret: string
  /** `null` quand la clé publique n'est pas configurée. */
  publishableKey: string | null
}) {
  const t = useTranslations('checkout')
  const stripePromise = useStripePromise(publishableKey)

  if (!stripePromise) {
    // La commande EXISTE et le stock est verrouillé : le dire clairement vaut
    // mieux qu'un cadre vide. C'est une panne de configuration, pas une erreur
    // de la personne.
    return (
      <Notice tone="danger" role="alert">
        <p>{t('paymentFrameFailed')}</p>
      </Notice>
    )
  }

  return (
    <div className="rounded-card border-[1.5px] border-rule bg-surface p-1">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}
