import 'server-only'

import { OrderStatus, type Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { availableActions, needsFulfilment } from '@/lib/domain/fulfilment'
import type { FulfilmentAction } from '@/lib/domain/fulfilment'
import { readPostalAddress, formatAddressLines } from '@/lib/domain/address'

/**
 * Les commandes à expédier, vues du côté de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Ce que cette file vient combler
 * ---------------------------------------------------------------------------
 * Il n'existait aucune façon de voir les commandes payées. Elles arrivaient par
 * l'e-mail de notification, et se géraient donc dans une boîte de réception :
 * un e-mail lu par erreur, un fil archivé, et un colis n'est jamais parti sans
 * que rien nulle part ne le signale.
 *
 * ---------------------------------------------------------------------------
 * L'ordre : la plus ancienne d'abord, et c'est l'inverse du réflexe
 * ---------------------------------------------------------------------------
 * Une liste de commandes se trie spontanément par nouveauté. Ici, ce serait le
 * bon moyen d'expédier la commande d'il y a dix minutes avant celle d'avant-
 * hier. La personne qui attend depuis le plus longtemps passe devant.
 *
 * ---------------------------------------------------------------------------
 * Ce que cette requête laisse dehors
 * ---------------------------------------------------------------------------
 * `costCentsSnapshot` et `shippingCostCents` — le coût d'achat et le coût
 * transporteur réel. Ils sont légitimes en régie, mais ils ne servent à RIEN
 * pour préparer un colis : les faire traverser ferait figurer la marge sur un
 * écran ouvert au comptoir pendant qu'on emballe. La file des offres, elle, les
 * montre, parce que décider d'un prix sans eux se fait au jugé.
 *
 * L'adresse, en revanche, sort en entier : c'est ce qui va sur l'étiquette.
 */

const fulfilmentOrderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  email: true,
  locale: true,
  totalCents: true,
  paidAt: true,
  shippedAt: true,
  shippingAddress: true,
  shippingCarrierCode: true,
  shippingServiceCode: true,
  servicePointId: true,
  customerNote: true,
  items: {
    select: {
      titleSnapshot: true,
      article: { select: { sku: true, weightGrams: true } },
    },
  },
  // Un seul envoi par commande aujourd'hui — rien ne découpe une commande en
  // plusieurs colis. Le modèle en autorise plusieurs, donc on lit le plus
  // récent plutôt que de supposer qu'il n'y en a qu'un.
  shipments: {
    select: { trackingNumber: true, trackingUrl: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.OrderSelect

type FulfilmentOrderRow = Prisma.OrderGetPayload<{
  select: typeof fulfilmentOrderSelect
}>

export interface AdminOrderEntry {
  id: string
  orderNumber: string
  status: OrderStatus
  email: string
  totalCents: number
  paidAt: Date | null
  shippedAt: Date | null
  /** L'adresse d'expédition, en lignes postales, telle qu'elle ira sur l'étiquette. */
  addressLines: string[]
  /** Ville et pays seuls, pour l'entête de ligne. */
  destination: { city: string; country: string }
  carrierCode: string
  serviceCode: string
  servicePointId: string | null
  customerNote: string | null
  items: { title: string; sku: string | null }[]
  /** Poids du contenu seul. L'emballage s'ajoute au moment de l'expédition. */
  contentWeightGrams: number
  /** Les gestes possibles depuis l'état courant — jamais devinés dans la vue. */
  actions: FulfilmentAction[]
  tracking: { number: string | null; url: string | null } | null
}

function toEntry(row: FulfilmentOrderRow): AdminOrderEntry {
  const address = readPostalAddress(row.shippingAddress)
  const shipment = row.shipments[0] ?? null

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    email: row.email,
    totalCents: row.totalCents,
    paidAt: row.paidAt,
    shippedAt: row.shippedAt,
    addressLines: formatAddressLines(address),
    destination: { city: address.city ?? '—', country: address.country ?? '—' },
    carrierCode: row.shippingCarrierCode,
    serviceCode: row.shippingServiceCode,
    servicePointId: row.servicePointId,
    customerNote: row.customerNote,
    items: row.items.map((item) => ({
      title: item.titleSnapshot,
      sku: item.article?.sku ?? null,
    })),
    contentWeightGrams: row.items.reduce(
      (total, item) => total + (item.article?.weightGrams ?? 0),
      0,
    ),
    actions: availableActions(row.status),
    tracking: shipment
      ? { number: shipment.trackingNumber, url: shipment.trackingUrl }
      : null,
  }
}

/**
 * Les états qui appellent un geste du vendeur.
 *
 * Énumérés depuis Prisma puis filtrés par le domaine, plutôt que recopiés à la
 * main. Deux bénéfices, et le second est le vrai : la liste ne peut pas
 * diverger de `needsFulfilment`, et un état ajouté demain au schéma passe par
 * ce filtre au lieu d'être oublié dans une constante que personne ne relit.
 */
const PENDING_STATUSES = Object.values(OrderStatus).filter(needsFulfilment)

/**
 * Les commandes qui attendent d'être expédiées.
 *
 * Les commandes déjà expédiées n'y figurent pas : elles n'attendent plus rien
 * du vendeur. Constater la livraison reste possible depuis le détail de la
 * commande — c'est un geste rare, et l'imposer dans cette file la remplirait de
 * lignes sur lesquelles il n'y a rien à faire.
 */
export async function listOrdersToFulfil(
  { limit = 100 }: { limit?: number } = {},
): Promise<AdminOrderEntry[]> {
  const rows = await prisma.order.findMany({
    where: { status: { in: [...PENDING_STATUSES] } },
    // La plus ancienne d'abord. Voir l'en-tête.
    //
    // `paidAt` et non `createdAt` : c'est l'instant où l'attente a commencé.
    // Une commande créée lundi et payée jeudi n'a pas fait attendre trois
    // jours — et `createdAt` la ferait passer devant des colis plus pressés.
    orderBy: { paidAt: 'asc' },
    take: limit,
    select: fulfilmentOrderSelect,
  })

  return rows.map(toEntry)
}

/**
 * Une commande précise, pour agir dessus depuis son détail.
 *
 * Sert au geste « marquer livrée », qui vient après l'expédition et donc après
 * la sortie de la file.
 */
export async function getOrderForFulfilment(
  orderNumber: string,
): Promise<AdminOrderEntry | null> {
  const row = await prisma.order.findUnique({
    where: { orderNumber },
    select: fulfilmentOrderSelect,
  })

  return row ? toEntry(row) : null
}

/** Combien de commandes attendent d'être expédiées. Sert au tableau de bord. */
export async function countOrdersToFulfil(): Promise<number> {
  return prisma.order.count({ where: { status: { in: [...PENDING_STATUSES] } } })
}
