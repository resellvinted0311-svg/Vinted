import 'server-only'

import Stripe from 'stripe'

/**
 * Client Stripe.
 *
 * ---------------------------------------------------------------------------
 * Aucune clé de repli, jamais
 * ---------------------------------------------------------------------------
 * Une clé de test écrite en dur « pour que ça tourne en développement » finit
 * par tourner en production le jour d'une variable oubliée : la boutique
 * encaisse alors dans un compte de démonstration, et personne ne le remarque
 * avant le premier virement qui n'arrive pas.
 *
 * Sans `STRIPE_SECRET_KEY`, ce module lève. Le paiement se neutralise
 * proprement en amont — même logique que `isAuthConfigured()` pour la
 * connexion.
 *
 * ---------------------------------------------------------------------------
 * Construction paresseuse
 * ---------------------------------------------------------------------------
 * Le client n'est pas créé à l'import. Un module importé au chargement d'une
 * page ferait échouer TOUTE la boutique — catalogue compris — sur un
 * déploiement sans clé, alors que seul le paiement devrait s'éteindre.
 */
let client: Stripe | null = null

/** Le paiement est-il configuré sur ce déploiement ? */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super(
      'STRIPE_SECRET_KEY est absente : le paiement ne peut pas être activé.',
    )
    this.name = 'StripeNotConfiguredError'
  }
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new StripeNotConfiguredError()

  if (!client) {
    client = new Stripe(key, {
      // Version épinglée, et c'est celle que la bibliothèque installée
      // connaît (`stripe/cjs/apiVersion.js`) — pas une version choisie de
      // mémoire. Une dérive silencieuse de l'API changerait la forme des
      // objets reçus par le webhook, donc la façon dont une commande est
      // marquée payée.
      apiVersion: '2026-07-29.dahlia',
      // Utile dans le tableau de bord Stripe pour distinguer les appels.
      appInfo: { name: 'Nina & Diego' },
      // Les erreurs réseau se retentent, mais pas indéfiniment : une commande
      // qui attend est une personne devant un écran.
      maxNetworkRetries: 2,
      timeout: 15_000,
    })
  }

  return client
}

/** Réinitialise le client mémorisé. Réservé aux tests. */
export function __resetStripeClientForTests(): void {
  client = null
}
