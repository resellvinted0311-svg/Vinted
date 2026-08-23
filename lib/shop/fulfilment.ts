import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { hasLegalIdentity } from '@/lib/config/site'
import { allocateInvoiceNumber } from '@/lib/shop/invoice'
import { enqueue } from '@/lib/jobs/queue'
import { enqueueSyncEvents } from '@/lib/sync/outbound'

/**
 * Confirmation d'une vente.
 *
 * ---------------------------------------------------------------------------
 * Toute transition d'état est un UPDATE conditionnel
 * ---------------------------------------------------------------------------
 * Aucune fonction de ce fichier ne lit un statut puis écrit sans condition.
 * C'est le patron que `stock-lock.ts` applique déjà à l'article, et pour la
 * même raison : entre la lecture et l'écriture, rien ne verrouille la ligne.
 *
 * Le défaut évité, vérifié : `checkout.session.completed` et le balayage des
 * commandes anciennes tombent au même instant. Les deux lisent
 * `PENDING_PAYMENT`. Le paiement écrit PAID et valide. Le balayage, lui, écrit
 * `status='CANCELLED'` sans prédicat — et écrase PAID. La commande finit
 * annulée avec une date de paiement, l'argent encaissé, la pièce vendue, et
 * elle n'apparaît dans aucune liste de commandes à préparer. Silencieusement.
 *
 * `UPDATE … WHERE id = … AND status = … RETURNING id` règle cela : zéro ligne
 * renvoyée signifie que quelqu'un d'autre a fait la transition entre-temps, et
 * l'on sort sans rien toucher.
 *
 * ---------------------------------------------------------------------------
 * Idempotence
 * ---------------------------------------------------------------------------
 * Un webhook est rejoué : sur timeout, sur 500, pendant un déploiement, et
 * parfois simplement en doublon. Ces fonctions doivent pouvoir tourner deux
 * fois, dix fois, sans jamais marquer deux ventes ni écraser une date de
 * paiement par une plus récente. La transition conditionnelle assure les deux.
 *
 * ---------------------------------------------------------------------------
 * Le stock ne se libère jamais à l'aveugle
 * ---------------------------------------------------------------------------
 * Libérer « toute pièce de cette commande qui est RÉSERVÉE » ignore à qui
 * appartient la réservation. Une commande abandonnée dont le verrou a expiré,
 * puis rachetée par quelqu'un d'autre, verrait sa pièce libérée sous le nez de
 * l'acheteur suivant — au moment exact où il la paie.
 *
 * `Order.lockOwnerId` mémorise donc le propriétaire, et toute libération est
 * bornée à lui.
 */

export interface FulfilmentResult {
  /** Faux si la commande avait déjà quitté l'attente de paiement. */
  applied: boolean
  /** Pièces réellement passées en vendu. */
  soldArticleIds: string[]
  /**
   * Pièces qui n'ont pas pu l'être — vendues ou réservées par quelqu'un
   * d'autre. Non vide = un remboursement est dû.
   */
  unfulfillableArticleIds: string[]
}

const NOTHING: FulfilmentResult = {
  applied: false,
  soldArticleIds: [],
  unfulfillableArticleIds: [],
}

/**
 * Fait passer une commande d'un état à un autre, atomiquement.
 *
 * Renvoie faux si la commande n'était plus dans l'un des états attendus : elle
 * a changé entre-temps, et c'est l'autre transaction qui fait foi.
 */
async function transition(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string
    from: readonly string[]
    to: string
    paidAt?: Date
    cancelledAt?: Date | null
    paymentIntentId?: string | null
  },
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Order"
    SET "status" = ${input.to}::"OrderStatus",
        "paidAt" = COALESCE(${input.paidAt ?? null}::timestamptz, "paidAt"),
        "cancelledAt" = ${input.cancelledAt ?? null}::timestamptz,
        "stripePaymentIntentId" = COALESCE(
          ${input.paymentIntentId ?? null}::text,
          "stripePaymentIntentId"
        ),
        "updatedAt" = now()
    WHERE "id" = ${input.orderId}
      AND "status" = ANY(${[...input.from]}::"OrderStatus"[])
    RETURNING "id"
  `

  return rows.length > 0
}

/**
 * Marque une commande payée et ses pièces vendues.
 *
 * `paidAt` vient de l'événement de paiement, jamais de l'horloge du serveur :
 * c'est la date qui figurera sur la facture, et elle doit correspondre au
 * relevé bancaire.
 *
 * Une commande ANNULÉE se rouvre. Le balayage annule les commandes dont la
 * session a expiré, et un paiement peut arriver juste après — Stripe ne
 * garantit pas l'ordre des événements. Refuser reviendrait à encaisser sans
 * qu'aucune commande n'existe : le pire des états, parce qu'il est invisible.
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
        userId: true,
        lockOwnerId: true,
        items: { select: { articleId: true } },
      },
    })

    if (!order) {
      throw new Error(`Commande introuvable : ${input.orderId}`)
    }

    // La transition EN PREMIER : elle sérialise cette transaction avec toute
    // autre qui toucherait la même commande, et elle échoue franchement si la
    // commande a déjà été payée.
    const moved = await transition(tx, {
      orderId: order.id,
      from: ['PENDING_PAYMENT', 'CANCELLED'],
      to: 'PAID',
      paidAt: input.paidAt,
      // Une commande rouverte n'est plus annulée : laisser la date
      // d'annulation ferait dire à l'historique « payée » et « annulée ».
      cancelledAt: null,
      paymentIntentId: input.paymentIntentId,
    })

    if (!moved) return NOTHING

    const articleIds = order.items.map((item) => item.articleId)

    // Passage en vendu, conditionnel.
    //
    // Sont vendables : les pièces libres, et celles que CETTE commande a
    // réservées. Une pièce réservée ou vendue par quelqu'un d'autre ne l'est
    // pas — la lui prendre ferait disparaître son achat.
    const sold = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Article"
      SET "status" = 'SOLD',
          "soldAt" = now(),
          "reservedById" = NULL,
          "reservedUntil" = NULL,
          "updatedAt" = now()
      WHERE "id" = ANY(${articleIds}::text[])
        AND (
          "status" = 'AVAILABLE'
          OR (
            "status" = 'RESERVED'
            AND "reservedById" IS NOT DISTINCT FROM ${order.lockOwnerId}
          )
        )
      RETURNING "id"
    `

    const soldIds = new Set(sold.map((row) => row.id))
    const unfulfillable = articleIds.filter((id) => !soldIds.has(id))

    // Numéro de facture attribué ICI, dans la transaction de la vente.
    //
    // C'est ce qui rend la suite sans trou : si cette transaction échoue,
    // l'incrément échoue avec elle. Une séquence PostgreSQL, elle, ne revient
    // jamais en arrière — voir `lib/shop/invoice.ts`.
    //
    // Seulement si l'identité légale est renseignée : une facture sans
    // dénomination ni SIRET ne vaut rien, et consommer un numéro pour un
    // document sans valeur ferait un trou dans la suite le jour où on le
    // corrigerait.
    if (hasLegalIdentity()) {
      const invoiceNumber = await allocateInvoiceNumber(tx)
      await tx.order.update({
        where: { id: order.id },
        data: { invoiceNumber },
      })
    }

    // Les e-mails sont INSCRITS, pas envoyés : un appel réseau dans une
    // transaction tiendrait des verrous en attendant un tiers, et un message
    // parti ne se rembobine pas si la transaction échoue ensuite. S'ils sont
    // inscrits, c'est que la vente l'est aussi.
    await enqueue(tx, {
      type: 'order.confirmation',
      payload: { orderId: order.id },
    })
    await enqueue(tx, {
      type: 'order.notify-shop',
      payload: { orderId: order.id },
    })

    // La vente remonte à l'application de gestion, source de vérité de
    // l'inventaire. Elle ne peut pas la deviner : une pièce ne part pas parce
    // qu'on l'a déclarée partie, elle part parce qu'un paiement a été encaissé
    // ici. Inscrite dans CETTE transaction, comme les e-mails, et pour la même
    // raison — si la vente est enregistrée, la remontée est due.
    //
    // `paidAt` et non `now()` : c'est l'instant du fait, et c'est la clé
    // d'idempotence de l'autre côté.
    await enqueueSyncEvents(tx, {
      event: 'article.sold',
      articleIds: [...soldIds],
      occurredAt: input.paidAt,
      orderId: order.id,
    })

    // Le panier a fait son travail : il disparaît une fois la commande payée.
    // C'est le seul endroit qui a le droit de le vider — jamais une lecture,
    // jamais un affichage.
    if (order.userId) {
      await tx.cart.deleteMany({ where: { userId: order.userId } })
    } else if (order.lockOwnerId) {
      // Sans compte, le panier se retrouve par le jeton de session, qui est
      // aussi le propriétaire du verrou. Sans cette branche, une visiteuse
      // repartait avec son panier intact après avoir payé.
      await tx.cart.deleteMany({ where: { sessionToken: order.lockOwnerId } })
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
 * perdre — panne, déploiement, endpoint désactivé. Sans ce balayage, ces
 * commandes resteraient en attente de paiement pour toujours alors que leur
 * stock a été rendu : la boutique afficherait une file de commandes fantômes
 * que personne ne peut ni payer ni honorer.
 *
 * La marge est délibérément large. Annuler trop tôt une commande encore
 * payable ne perd pas la vente — `markOrderPaid` rouvre une commande annulée —
 * mais produirait un aller-retour d'états inutile dans l'historique.
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
 * Ne touche jamais une commande déjà payée : un événement d'expiration peut
 * arriver APRÈS un paiement réussi, et il ne doit surtout pas défaire une
 * vente. La transition conditionnelle le garantit même en cas de simultanéité.
 */
export async function expireOrder(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        lockOwnerId: true,
        items: { select: { articleId: true } },
      },
    })

    if (!order) return false

    // La transition EN PREMIER. Si un paiement vient de passer cette commande
    // en PAID, zéro ligne revient et l'on sort sans avoir touché au stock.
    const moved = await transition(tx, {
      orderId: order.id,
      from: ['PENDING_PAYMENT'],
      to: 'CANCELLED',
      cancelledAt: new Date(),
    })

    if (!moved) return false

    // Sans propriétaire connu — commandes antérieures à cette colonne — on ne
    // libère RIEN. Libérer à l'aveugle risquerait de remettre en vente une
    // pièce que quelqu'un d'autre est en train de payer ; le balayage des
    // verrous expirés s'en chargera, lui, sans ce risque.
    if (!order.lockOwnerId) return true

    const articleIds = order.items.map((item) => item.articleId)

    // `reservedById = ${owner}` n'est pas une précaution de style. Sans elle,
    // une commande abandonnée dont le verrou a expiré, puis rachetée par
    // quelqu'un d'autre, libérerait la pièce sous le nez de l'acheteur
    // suivant — au moment exact où il la paie.
    //
    // `RETURNING` plutôt qu'un simple compte : on remonte à l'application de
    // gestion les pièces RÉELLEMENT libérées, pas celles qu'on a demandé de
    // libérer. La différence est exactement le cas ci-dessus.
    const released = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Article"
      SET "status" = 'AVAILABLE',
          "reservedById" = NULL,
          "reservedUntil" = NULL,
          "updatedAt" = now()
      WHERE "id" = ANY(${articleIds}::text[])
        AND "status" = 'RESERVED'
        AND "reservedById" = ${order.lockOwnerId}
      RETURNING "id"
    `

    await enqueueSyncEvents(tx, {
      event: 'article.released',
      articleIds: released.map((row) => row.id),
      occurredAt: new Date(),
    })

    return true
  })
}
