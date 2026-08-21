import 'server-only'

import { prisma } from '@/lib/db/client'

/**
 * Confirmation d'une vente.
 *
 * ---------------------------------------------------------------------------
 * Idempotence
 * ---------------------------------------------------------------------------
 * Un webhook est rejoué. Stripe le rejoue en cas de timeout, de 500, de
 * déploiement en cours — et parfois simplement parce qu'il double un envoi.
 * Cette fonction doit donc pouvoir tourner deux fois, dix fois, sans jamais
 * marquer deux ventes, ni écraser une date de paiement par une plus récente.
 *
 * La garde est une lecture du statut dans la transaction : une commande déjà
 * PAID ressort telle quelle.
 *
 * ---------------------------------------------------------------------------
 * Payer une pièce déjà partie
 * ---------------------------------------------------------------------------
 * Ce cas est fermé PAR CONSTRUCTION en amont : le verrou de stock dure au
 * moins aussi longtemps que la session de paiement (voir
 * `STRIPE_MIN_SESSION_MINUTES` dans checkout.ts), donc la fenêtre où une pièce
 * redevient libre pendant que quelqu'un saisit sa carte n'existe pas.
 *
 * Le passage en vendu reste malgré tout CONDITIONNEL, parce qu'une garantie de
 * conception n'est pas une garantie d'exécution : un article libéré à la main
 * depuis le back-office, une horloge qui dérive, un verrou relâché par erreur.
 * Le jour où l'un de ces cas se produit, il ne doit pas se traduire par
 * l'écrasement de la vente de quelqu'un d'autre.
 *
 * S'il se produit, l'argent EST pris. La seule chose honnête est de le dire :
 * la commande est marquée payée — nier un débit réel serait pire — et les
 * lignes non honorables partent dans `AuditLog`. Consigné, pas résolu : le
 * remboursement est une décision humaine.
 */

export interface FulfilmentResult {
  /** Faux si la commande était déjà payée : rien n'a été refait. */
  applied: boolean
  /** Pièces réellement passées en vendu. */
  soldArticleIds: string[]
  /**
   * Pièces qui n'ont pas pu l'être — déjà vendues à quelqu'un d'autre.
   * Non vide = un remboursement est dû.
   */
  unfulfillableArticleIds: string[]
}

/**
 * Marque une commande payée et ses pièces vendues.
 *
 * `paidAt` vient de l'événement de paiement quand il est connu, jamais de
 * l'horloge du serveur : c'est la date qui figurera sur la facture, et elle
 * doit correspondre au relevé bancaire.
 */
export async function markOrderPaid(input: {
  orderId: string
  paymentIntentId: string | null
  paidAt: Date
}): Promise<FulfilmentResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        userId: true,
        items: { select: { articleId: true } },
      },
    })

    if (!order) {
      throw new Error(`Commande introuvable : ${input.orderId}`)
    }

    // Déjà payée : on ne retouche ni la date, ni le stock.
    //
    // Une commande ANNULÉE, en revanche, se rouvre. Le balayage annule les
    // commandes dont la session a expiré, et un paiement peut arriver juste
    // après — Stripe ne garantit pas l'ordre des événements. Refuser ici
    // reviendrait à encaisser sans qu'aucune commande n'existe : le pire des
    // états possibles, parce qu'il est invisible.
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') {
      return {
        applied: false,
        soldArticleIds: [],
        unfulfillableArticleIds: [],
      }
    }

    const articleIds = order.items.map((item) => item.articleId)

    // Passage en vendu, conditionnel et atomique.
    //
    // La condition exclut ce qui est DÉJÀ vendu — donc vendu à quelqu'un
    // d'autre. Un `updateMany` sans condition écraserait la vente de l'autre
    // personne et ferait disparaître son achat.
    const sold = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Article"
      SET "status" = 'SOLD',
          "soldAt" = now(),
          "reservedById" = NULL,
          "reservedUntil" = NULL,
          "updatedAt" = now()
      WHERE "id" = ANY(${articleIds}::text[])
        AND "status" <> 'SOLD'
      RETURNING "id"
    `

    const soldIds = new Set(sold.map((row) => row.id))
    const unfulfillable = articleIds.filter((id) => !soldIds.has(id))

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: input.paidAt,
        // Une commande rouverte n'est plus annulée : laisser la date
        // d'annulation ferait mentir l'historique.
        cancelledAt: null,
        ...(input.paymentIntentId
          ? { stripePaymentIntentId: input.paymentIntentId }
          : {}),
      },
    })

    // Le panier a fait son travail : il disparaît une fois la commande payée.
    // C'est le seul endroit qui a le droit de le vider — jamais une lecture,
    // jamais un affichage.
    if (order.userId) {
      await tx.cart.deleteMany({ where: { userId: order.userId } })
    }

    if (unfulfillable.length > 0) {
      // Consigné, pas résolu. Une personne doit voir passer ceci.
      await tx.auditLog.create({
        data: {
          action: 'order.unfulfillable_lines',
          entity: 'Order',
          entityId: order.id,
          after: { articleIds: unfulfillable },
        },
      })
    }

    return {
      applied: true,
      soldArticleIds: [...soldIds],
      unfulfillableArticleIds: unfulfillable,
    }
  })
}

/**
 * Annule les commandes dont la fenêtre de paiement est passée.
 *
 * Stripe envoie bien `checkout.session.expired`, mais un webhook peut se
 * perdre — panne, déploiement, désactivation temporaire de l'endpoint. Sans
 * ce balayage, ces commandes resteraient PENDING_PAYMENT pour toujours, alors
 * que le verrou de stock, lui, aurait été relâché : la boutique afficherait
 * une file de commandes fantômes que personne ne peut ni payer ni honorer.
 *
 * La marge est délibérément large. Annuler trop tôt une commande encore
 * payable ne perdrait pas la vente — `markOrderPaid` rouvre une commande
 * annulée — mais produirait un aller-retour d'états inutile dans l'historique.
 */
export async function expireStaleOrders(
  graceMinutes: number,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000)

  const stale = await prisma.order.findMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true },
    // Borne de sécurité : un balayage qui traiterait des milliers de lignes
    // d'un coup dépasserait le temps alloué et échouerait en entier.
    take: 100,
  })

  let cancelled = 0
  for (const order of stale) {
    if (await expireOrder(order.id)) cancelled += 1
  }

  return cancelled
}

/**
 * Abandonne une commande jamais payée et rend son stock.
 *
 * Appelée sur expiration de la session de paiement. Ne touche jamais une
 * commande déjà payée : un événement d'expiration peut arriver APRÈS un
 * paiement réussi, et il ne doit surtout pas défaire une vente.
 */
export async function expireOrder(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, items: { select: { articleId: true } } },
    })

    if (!order || order.status !== 'PENDING_PAYMENT') return false

    const articleIds = order.items.map((item) => item.articleId)

    // Seules les pièces encore RÉSERVÉES sont rendues. Une pièce déjà vendue
    // — à quelqu'un d'autre, entre-temps — n'a pas à être « libérée ».
    await tx.$executeRaw`
      UPDATE "Article"
      SET "status" = 'AVAILABLE',
          "reservedById" = NULL,
          "reservedUntil" = NULL,
          "updatedAt" = now()
      WHERE "id" = ANY(${articleIds}::text[])
        AND "status" = 'RESERVED'
    `

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })

    return true
  })
}
