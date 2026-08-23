import 'server-only'

import type { Prisma } from '@prisma/client'

import { enqueue } from '@/lib/jobs/queue'

/**
 * Remontée des changements d'état vers l'application de gestion.
 *
 * L'application est la SOURCE DE VÉRITÉ de l'inventaire, mais elle ne peut pas
 * savoir seule qu'une pièce est partie : cela dépend d'un paiement encaissé
 * ici. Ce module est le point unique d'où part cette information.
 *
 * ---------------------------------------------------------------------------
 * Inscrit dans la transaction, envoyé après
 * ---------------------------------------------------------------------------
 * Même raisonnement que pour les e-mails de commande, et il n'est pas
 * théorique : appeler l'application PENDANT la transaction de vente tiendrait
 * des verrous de base en attendant un tiers, et ferait échouer un paiement
 * encaissé si ce tiers est indisponible. Appeler après, sans attendre, ne
 * marche pas non plus — sur une fonction serverless, le processus est gelé dès
 * la réponse rendue et l'appel ne part jamais.
 *
 * On inscrit donc l'intention dans la MÊME transaction que la vente. Si la
 * vente est enregistrée, la remontée est due ; si elle échoue, elle ne l'est
 * pas.
 *
 * ---------------------------------------------------------------------------
 * Seules les pièces VENUES de l'application sont remontées
 * ---------------------------------------------------------------------------
 * Une pièce créée en back-office ou par le jeu de démonstration n'a pas
 * d'`externalId` : l'application ne la connaît pas, et lui annoncer la vente
 * d'un identifiant qu'elle n'a jamais émis ne peut produire qu'une erreur de
 * son côté.
 *
 * ---------------------------------------------------------------------------
 * Sans destination configurée, rien n'est inscrit
 * ---------------------------------------------------------------------------
 * Une boutique dont l'application n'est pas branchée accumulerait sinon deux
 * travaux morts par vente, qui échoueraient six fois chacun avant d'être
 * abandonnés — un journal illisible, et une file qui grossit.
 *
 * Ce qui est perdu ainsi n'est pas perdu : `GET /api/sync/changes` rejoue
 * l'état depuis n'importe quelle date, et c'est précisément le filet prévu par
 * le contrat pour une application restée éteinte.
 */

export type SyncEventName =
  | 'article.sold'
  | 'article.reserved'
  | 'article.released'
  | 'article.price_dropped'

/** La remontée est-elle configurée des deux côtés ? */
export function isSyncOutboundConfigured(): boolean {
  return Boolean(
    process.env.SYNC_WEBHOOK_URL && process.env.SYNC_WEBHOOK_SECRET,
  )
}

export interface SyncEventInput {
  event: SyncEventName
  /** Pièces concernées. Celles sans `externalId` sont ignorées en silence. */
  articleIds: readonly string[]
  /**
   * Instant du fait, figé ICI et jamais recalculé.
   *
   * C'est la clé d'idempotence de l'autre côté : le contrat promet que le même
   * `externalId`, le même événement et le même `occurredAt` ne produisent
   * qu'un seul effet. Recalculer cet horodatage à chaque reprise ferait passer
   * chaque tentative pour un fait nouveau, et une vente rejouée six fois
   * apparaîtrait six fois.
   */
  occurredAt: Date
  /** Commande d'origine, pour les événements de vente. */
  orderId?: string
  /** Prix avant la baisse, pour `article.price_dropped`. */
  previousPriceCents?: number
}

/**
 * Inscrit une remontée par pièce concernée.
 *
 * Un seul aller en base pour filtrer les pièces connues de l'application,
 * quelle que soit la taille de la commande.
 *
 * Renvoie le nombre de travaux inscrits — utile aux tests et au diagnostic,
 * jamais à une décision métier.
 */
export async function enqueueSyncEvents(
  tx: Prisma.TransactionClient,
  input: SyncEventInput,
): Promise<number> {
  if (!isSyncOutboundConfigured()) return 0

  const ids = [...new Set(input.articleIds)]
  if (ids.length === 0) return 0

  const known = await tx.article.findMany({
    where: { id: { in: ids }, externalId: { not: null } },
    select: { id: true },
  })

  for (const article of known) {
    await enqueue(tx, {
      type: 'sync.notify',
      payload: {
        event: input.event,
        articleId: article.id,
        occurredAt: input.occurredAt.toISOString(),
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.previousPriceCents === undefined
          ? {}
          : { previousPriceCents: input.previousPriceCents }),
      },
    })
  }

  return known.length
}
