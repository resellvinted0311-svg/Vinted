import type { ArticleStatus } from '@prisma/client'

/**
 * Mettre une pièce en vente, ou l'en retirer.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi DEUX gestes et pas cinq
 * ---------------------------------------------------------------------------
 * Un premier découpage en distinguait quatre — publier, retirer, archiver,
 * restaurer — plus une libération de verrou échu. Trois d'entre eux étaient le
 * même geste sous deux noms : « restaurer » est publier, « archiver » est
 * retirer, et la libération d'un verrou échu est déjà faite toutes les cinq
 * minutes par le balayage périodique.
 *
 * Chaque geste en trop coûte un membre d'union, un bouton, un état de refus,
 * une clé de traduction dans huit langues et un cas de test — pour une
 * transition qui existait déjà. On n'en garde donc que deux.
 *
 * ---------------------------------------------------------------------------
 * Aucun geste ne produit SCHEDULED ni SOLD
 * ---------------------------------------------------------------------------
 * `SOLD` s'écrit à l'encaissement et nulle part ailleurs : le poser à la main
 * mentirait sur une vente qui n'a pas eu lieu, et une pièce marquée vendue sans
 * commande n'apparaît dans aucun registre. `SCHEDULED` demande une date de
 * parution et un balayage qui la surveille ; tant que l'écran ne propose pas de
 * programmer, l'état resterait sans issue.
 *
 * ---------------------------------------------------------------------------
 * Ce module ne touche PAS la base
 * ---------------------------------------------------------------------------
 * Il décide, il n'écrit pas. C'est ce qui permet de l'exercer sur les vingt
 * combinaisons d'état sans base de données, et surtout de vérifier les refus —
 * la partie qu'on n'écrit jamais quand la règle vit à l'intérieur d'une
 * requête.
 */

export type ListingAction = 'publish' | 'withdraw'

export type ListingRefusal =
  /** Déjà en vente : le geste n'a rien à faire. */
  | 'already-listed'
  /** Déjà retirée. */
  | 'already-withdrawn'
  /** Vendue : son prix figure sur une facture qu'une cliente détient. */
  | 'sold'
  /** Un panier la tient, et le paiement peut encore aboutir. */
  | 'reserved'
  /** Une commande attend son paiement : la retirer ferait perdre la vente. */
  | 'awaiting-payment'
  /** Sans photo, une fiche publiée est une fiche que personne n'ouvre. */
  | 'no-image'

export interface ListingSubject {
  status: ArticleStatus
  /** Au moins un visuel réellement stocké. */
  hasImage: boolean
  /**
   * La réservation court-elle encore ?
   *
   * `status = RESERVED` ne suffit pas : le balayage qui libère les verrous
   * échus passe toutes les cinq minutes, donc une pièce peut porter l'état
   * RESERVED alors que son verrou est mort depuis quatre minutes. La traiter
   * comme réservée bloquerait la boutiquière sans raison.
   */
  lockLive: boolean
  /**
   * Existe-t-il une commande non payée qui porte cette pièce ?
   *
   * Le cas que cela évite est le plus coûteux de tous : Stripe ne garantit ni
   * l'ordre ni le délai de ses webhooks, et l'encaissement ROUVRE une commande
   * déjà annulée. Retirer la pièce entre-temps la fait sortir de la clause que
   * l'encaissement exige — l'argent est pris, la commande passe payée, une
   * facture est numérotée, et la pièce n'est jamais marquée vendue. La seule
   * trace serait une ligne d'audit que personne ne lit le jour même.
   */
  awaitingPayment: boolean
}

export type ListingPlan =
  | {
      ok: true
      to: ArticleStatus
      /**
       * Poser la date de mise en ligne, si elle est encore nulle.
       *
       * Une pièce `AVAILABLE` dont `publishedAt` est nul est exclue de la
       * visibilité publique : introuvable au catalogue, 404 sur sa fiche, et
       * refusée par le verrou de stock. La boutiquière verrait « en vente » une
       * pièce que personne ne peut ni ouvrir ni acheter.
       *
       * Seulement si elle est nulle : la repositionner à chaque republication
       * ferait remonter en tête des nouveautés une pièce qui traîne depuis six
       * mois, et remettrait à zéro le compte à rebours des offres.
       */
      setPublishedAt: boolean
      /**
       * Effacer le réservataire.
       *
       * Une pièce remise en vente ne doit pas traîner l'identité de qui l'avait
       * au panier : la colonne est classée privée, et un verrou fantôme fausse
       * le prochain calcul de disponibilité.
       */
      clearReservation: boolean
    }
  | { ok: false; reason: ListingRefusal }

/**
 * La transition demandée est-elle permise depuis l'état courant ?
 *
 * L'appelant ne fournit JAMAIS l'état d'arrivée — il envoie un geste, et c'est
 * ici qu'on décide. C'est ce qui interdit de reculer, de sauter une étape, ou
 * de publier une pièce vendue : trois choses qu'un `status` reçu du réseau
 * rendrait possibles.
 */
export function planListing(
  action: ListingAction,
  subject: ListingSubject,
): ListingPlan {
  // Vendue : aucun geste. Le prix, le titre et l'état figurent sur une facture
  // qui a valeur comptable pendant dix ans.
  if (subject.status === 'SOLD') return { ok: false, reason: 'sold' }

  if (action === 'publish') {
    if (subject.status === 'AVAILABLE' && !subject.lockLive) {
      return { ok: false, reason: 'already-listed' }
    }

    // Réservée pour de bon : republier n'a aucun sens, la pièce est déjà en
    // vente et quelqu'un est en train de la payer.
    if (subject.lockLive) return { ok: false, reason: 'reserved' }

    if (!subject.hasImage) return { ok: false, reason: 'no-image' }

    return {
      ok: true,
      to: 'AVAILABLE',
      setPublishedAt: true,
      // Vrai aussi depuis un RESERVED à verrou mort : c'est précisément le cas
      // où la colonne porte encore un réservataire qui n'a plus de droits.
      clearReservation: true,
    }
  }

  if (subject.status === 'ARCHIVED') {
    return { ok: false, reason: 'already-withdrawn' }
  }

  // Un panier la tient : la retirer sous quelqu'un qui paie est le défaut que
  // ce module existe pour empêcher.
  if (subject.lockLive) return { ok: false, reason: 'reserved' }

  if (subject.awaitingPayment) {
    return { ok: false, reason: 'awaiting-payment' }
  }

  return {
    ok: true,
    to: 'ARCHIVED',
    setPublishedAt: false,
    clearReservation: false,
  }
}

/**
 * Les gestes proposables depuis un état.
 *
 * Le serveur refuse de toute façon ce qui n'est pas permis — `planListing` est
 * rejoué dans la transaction. Ce que cette liste apporte est plus modeste et
 * plus utile : ne pas faire cliquer pour rien.
 */
export function availableListingActions(subject: ListingSubject): ListingAction[] {
  return (['publish', 'withdraw'] as const).filter(
    (action) => planListing(action, subject).ok,
  )
}

/**
 * Les états depuis lesquels une écriture de contenu est permise.
 *
 * Corriger le titre ou le prix d'une pièce VENDUE réécrirait ce qu'une facture
 * affirme. Le faire sur une pièce RÉSERVÉE changerait le prix sous un paiement
 * en cours — l'acheteuse a vu un montant à l'écran, elle en paierait un autre.
 */
export const EDITABLE_STATUSES: readonly ArticleStatus[] = [
  'DRAFT',
  'AVAILABLE',
  'ARCHIVED',
]

export function isEditable(subject: Pick<ListingSubject, 'status' | 'lockLive'>): boolean {
  return EDITABLE_STATUSES.includes(subject.status) && !subject.lockLive
}
