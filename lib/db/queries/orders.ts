import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import type { CartOwner } from '@/lib/shop/cart'

/**
 * Lecture des commandes, côté acheteuse.
 *
 * ---------------------------------------------------------------------------
 * Qui a le droit de lire quoi
 * ---------------------------------------------------------------------------
 * Une commande appartient soit à un COMPTE, soit à un JETON de session
 * boutique — le paiement sans compte est autorisé, et quelqu'un qui a payé
 * doit pouvoir suivre sa commande sans avoir à s'inscrire après coup.
 *
 * La portée est donc toujours donnée par le propriétaire, jamais par un
 * identifiant reçu du réseau. Un numéro de commande est court et lisible : s'il
 * suffisait à ouvrir une commande, il suffirait aussi à lire l'adresse de
 * quelqu'un d'autre.
 *
 * ---------------------------------------------------------------------------
 * Ce qui ne sort jamais
 * ---------------------------------------------------------------------------
 * `costCentsSnapshot` (coût d'achat de la pièce) et `shippingCostCents` (coût
 * transporteur réel) sont des données de l'entreprise. Les sélecteurs
 * ci-dessous les omettent — on énumère les colonnes voulues plutôt que
 * d'exclure les colonnes privées, pour qu'ajouter demain une colonne privée au
 * schéma ne puisse pas la faire fuiter par omission.
 */

/**
 * Portée de lecture : le compte OU le jeton de la session, jamais plus large.
 *
 * `readCartOwner` peut renvoyer une chaîne VIDE pour le jeton — un compte
 * ouvert dans un navigateur qui n'a pas de cookie boutique. Une chaîne vide
 * n'est pas un propriétaire : la laisser entrer dans le `OR` ferait
 * correspondre toute commande dont le champ vaudrait lui aussi la chaîne vide.
 * On n'écrit jamais cette valeur aujourd'hui, mais la portée d'une lecture ne
 * doit pas dépendre d'une convention d'écriture qui pourrait changer.
 */
function ownerScope(owner: CartOwner): Prisma.OrderWhereInput {
  const scopes: Prisma.OrderWhereInput[] = []

  if (owner.userId) scopes.push({ userId: owner.userId })
  if (owner.lockOwnerId) scopes.push({ lockOwnerId: owner.lockOwnerId })

  // Aucun propriétaire identifiable : on ne renvoie rien. Une clause `where`
  // vide renverrait TOUTES les commandes de la boutique.
  if (scopes.length === 0) return { id: '' }

  return { OR: scopes }
}

const orderListSelect = {
  orderNumber: true,
  status: true,
  locale: true,
  totalCents: true,
  createdAt: true,
  paidAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  invoiceNumber: true,
  items: {
    select: {
      titleSnapshot: true,
      imageSnapshot: true,
      unitPriceCents: true,
      article: { select: { slug: true, sku: true } },
    },
  },
} satisfies Prisma.OrderSelect

const orderDetailSelect = {
  ...orderListSelect,
  email: true,
  subtotalCents: true,
  discountCents: true,
  shippingCents: true,
  shippingAddress: true,
  billingAddress: true,
  shippingCarrierCode: true,
  shippingServiceCode: true,
  servicePointId: true,
  customerNote: true,
  cgvVersion: true,
  cgvAcceptedAt: true,
  refundedCents: true,
  /**
   * L'expédition, quand elle existe.
   *
   * Trois colonnes seulement. `labelUrl` est l'étiquette d'affranchissement —
   * un document de l'entreprise, qui porte parfois le tarif négocié — et
   * `costCents` le coût transporteur réel : ni l'un ni l'autre n'a à sortir
   * ici. `providerRef` sert à annuler une étiquette côté transporteur, ce qui
   * n'est pas un geste d'acheteuse.
   *
   * `take: 1` sur la plus récente : rien ne découpe aujourd'hui une commande en
   * plusieurs colis, mais le modèle l'autorise, et supposer l'unicité
   * afficherait le premier suivi émis plutôt que le bon le jour où cela
   * changera.
   */
  shipments: {
    select: { trackingNumber: true, trackingUrl: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  // Volontairement absents : shippingCostCents, costCentsSnapshot,
  // stripeSessionId, stripePaymentIntentId, lockOwnerId.
} satisfies Prisma.OrderSelect

export type OrderListItem = Prisma.OrderGetPayload<{
  select: typeof orderListSelect
}>

export type OrderDetail = Prisma.OrderGetPayload<{
  select: typeof orderDetailSelect
}>

/**
 * Commandes de la personne, la plus récente d'abord.
 *
 * Les commandes jamais payées sont exclues : une tentative abandonnée n'est
 * pas un achat, et l'afficher ferait croire à une commande en cours.
 */
export async function listOrders(
  owner: CartOwner,
  limit = 50,
): Promise<OrderListItem[]> {
  return prisma.order.findMany({
    where: {
      ...ownerScope(owner),
      status: { not: 'PENDING_PAYMENT' },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: orderListSelect,
  })
}

/** Une commande, par son numéro, si elle appartient bien à cette personne. */
export async function getOrder(
  owner: CartOwner,
  orderNumber: string,
): Promise<OrderDetail | null> {
  return prisma.order.findFirst({
    where: { ...ownerScope(owner), orderNumber },
    select: orderDetailSelect,
  })
}

/**
 * La commande d'une session de paiement, pour la page de retour.
 *
 * ---------------------------------------------------------------------------
 * Cette page NE MARQUE RIEN comme payé
 * ---------------------------------------------------------------------------
 * Elle lit l'état que le webhook a écrit, et rien d'autre. Le cahier des
 * charges l'interdit explicitement, et pour une raison simple : cette URL est
 * une redirection du navigateur, que n'importe qui peut ouvrir à la main.
 *
 * L'identifiant de session vient de l'URL. Il est long et imprévisible, mais
 * ce n'est pas une raison de s'en contenter : la portée du propriétaire
 * s'applique aussi ici.
 *
 * ---------------------------------------------------------------------------
 * Le webhook peut être en retard
 * ---------------------------------------------------------------------------
 * La redirection du navigateur et l'appel de Stripe à notre webhook partent en
 * même temps. La page peut donc arriver AVANT que la commande soit marquée
 * payée. Elle doit dire « paiement en cours de confirmation », pas « échec » —
 * annoncer un échec sur un paiement réussi est la pire chose à faire à cet
 * instant précis.
 */
export async function getOrderByCheckoutSession(
  owner: CartOwner,
  sessionId: string,
): Promise<OrderDetail | null> {
  return prisma.order.findFirst({
    where: { ...ownerScope(owner), stripeSessionId: sessionId },
    select: orderDetailSelect,
  })
}

/**
 * Une commande existe-t-elle pour cette session, quel que soit son propriétaire ?
 *
 * Sert uniquement à distinguer « je ne trouve pas cette commande » de « elle
 * ne vous appartient pas ». On ne renvoie AUCUNE donnée — seulement l'existence
 * — parce que la nuance change le message affiché, pas ce qu'on montre.
 */
export async function checkoutSessionExists(sessionId: string): Promise<boolean> {
  const count = await prisma.order.count({ where: { stripeSessionId: sessionId } })
  return count > 0
}
