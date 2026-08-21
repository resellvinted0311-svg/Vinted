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
 * Le cas qu'on préférerait ne pas avoir
 * ---------------------------------------------------------------------------
 * Le verrou de stock a une durée de vie ; une session de paiement Stripe ne
 * peut pas expirer en moins de trente minutes. Il existe donc une fenêtre où
 * quelqu'un paie une pièce dont le verrou vient de tomber et qu'un autre a
 * achetée entre-temps.
 *
 * Dans ce cas, l'argent EST pris. La seule chose honnête est de le dire :
 * la commande est marquée payée — nier un débit réel serait pire — et les
 * lignes non honorables sont consignées pour remboursement. Aucune décision
 * automatique de remboursement n'est prise ici : elle appartient à la phase
 * suivante, et à une personne.
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

    // Déjà traitée. On ne retouche ni la date, ni le stock.
    if (order.status !== 'PENDING_PAYMENT') {
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
