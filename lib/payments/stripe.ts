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

/**
 * Les trois variables qu'une vente traverse, dans l'ordre où elle les
 * rencontre.
 *
 * Elles sont vérifiées ENSEMBLE, et c'est le cœur de ce fichier : chacune sert
 * à une étape différente, et il n'existe aucune étape qui puisse se passer des
 * deux autres.
 *
 *  - `STRIPE_SECRET_KEY` ouvre la session de paiement, côté serveur ;
 *  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` affiche le cadre de saisie de carte,
 *    côté navigateur ;
 *  - `STRIPE_WEBHOOK_SECRET` permet de VÉRIFIER l'appel signé qui marque la
 *    commande payée. Sans elle, la route de rappel refuse tout.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi n'en vérifier qu'une était un vrai défaut, pas une imprécision
 * ---------------------------------------------------------------------------
 * Le garde ne regardait que la clé secrète. Deux configurations partielles
 * plausibles — on pose les variables une par une — passaient donc le garde :
 *
 *  - clé secrète SEULE : le bouton « Commander » restait actif, la commande
 *    était créée, le stock verrouillé TRENTE MINUTES, et c'est seulement
 *    ensuite que le cadre de paiement affichait une panne. Une pièce
 *    disparaissait de la boutique pour une vente qui ne pouvait pas aboutir.
 *  - clé secrète et clé publique, SANS secret de rappel : le pire des deux.
 *    La carte est débitée, Stripe appelle la route de rappel, la route refuse
 *    faute de secret, et la commande ne devient JAMAIS payée. De l'argent
 *    encaissé en face d'une commande qui reste « en attente de paiement ».
 *
 * Le garde couvre maintenant les trois. La conséquence est que la boutique
 * refuse AVANT d'écrire quoi que ce soit, au lieu de refuser après — ce qui
 * est la seule différence qui compte pour la pièce et pour l'acheteuse.
 */
const VARIABLES_STRIPE = [
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const

/**
 * Les variables manquantes, nommées.
 *
 * Pour les journaux et pour l'écran d'état : « paiement non configuré » envoie
 * relire trois pages de documentation, « STRIPE_WEBHOOK_SECRET manquante »
 * envoie poser une variable.
 */
export function missingStripeKeys(): string[] {
  return VARIABLES_STRIPE.filter((nom) => !process.env[nom]?.trim())
}

/**
 * Une vente peut-elle aller jusqu'au bout sur ce déploiement ?
 *
 * C'est la question que posent les appelants — le bouton de commande,
 * l'ouverture de session, la route de rappel — et c'est donc à celle-là que
 * cette fonction répond. Pas « une clé est-elle posée ».
 */
export function isStripeConfigured(): boolean {
  return missingStripeKeys().length === 0
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
