import 'server-only'

import { createHmac } from 'node:crypto'

import { z } from 'zod'

import { prisma } from '@/lib/db/client'
import { getPricingConfig, getShippingConfig } from '@/lib/config/settings'
import { getShippingGrids } from '@/lib/db/queries/shipping'
import { readPostalAddress } from '@/lib/domain/address'
import { allocateProportionally } from '@/lib/domain/order-total'
import { stripeFeeCents } from '@/lib/domain/pricing'
import {
  computeParcelWeightGrams,
  resolveShippingZone,
} from '@/lib/domain/shipping'
import type { SyncEventName } from './outbound'

/**
 * Appel signé vers l'application de gestion.
 *
 * Contrat : `docs/synchronisation.md`, §3. Exécuté par la file de travaux,
 * jamais dans la transaction de vente.
 *
 * ---------------------------------------------------------------------------
 * Aucune donnée personnelle, et ce n'est pas une préférence
 * ---------------------------------------------------------------------------
 * Le corps ne porte ni nom, ni adresse e-mail, ni adresse postale, ni
 * identifiant d'acheteur. Une application de suivi d'inventaire n'a pas besoin
 * de savoir QUI a acheté pour savoir qu'une pièce est partie et à quel prix.
 *
 * Transmettre davantage ferait de l'application un DESTINATAIRE de données
 * personnelles au sens du RGPD : à déclarer au registre des traitements, à
 * couvrir par un contrat de sous-traitance, à faire figurer dans la politique
 * de confidentialité, et à sécuriser au même niveau. Le corps est donc
 * construit champ par champ, jamais par recopie d'une ligne de commande.
 *
 * ---------------------------------------------------------------------------
 * Le contenu se relit, l'INSTANT se transporte
 * ---------------------------------------------------------------------------
 * La file pose comme règle de ne transporter qu'un identifiant et de relire le
 * contenu à l'exécution — deux copies finissent toujours par diverger. Cette
 * règle vaut ici aussi pour les montants, qui sont lus dans les instantanés
 * figés de la commande.
 *
 * Elle ne vaut PAS pour `occurredAt`, qui voyage dans la charge utile. C'est
 * délibéré : le contrat fait de `(externalId, event, occurredAt)` la clé
 * d'idempotence de l'autre côté. Recalculé à chaque reprise, cet horodatage
 * ferait passer six tentatives pour six ventes.
 */

// ---------------------------------------------------------------------------
// Charge utile du travail
// ---------------------------------------------------------------------------

export const syncNotifyPayload = z.object({
  event: z.enum([
    'article.sold',
    'article.reserved',
    'article.released',
    'article.price_dropped',
  ]),
  articleId: z.string().min(1).max(64),
  occurredAt: z.iso.datetime(),
  orderId: z.string().min(1).max(64).optional(),
  previousPriceCents: z.number().int().nonnegative().optional(),
})

export type SyncNotifyPayload = z.infer<typeof syncNotifyPayload>

// ---------------------------------------------------------------------------
// Corps envoyé
// ---------------------------------------------------------------------------

export interface SyncSaleBlock {
  priceCents: number
  shippingPaidCents: number
  paymentFeeCents: number
  netCents: number
  /**
   * Nombre de pièces de la commande.
   *
   * Sans lui, `shippingPaidCents` et `paymentFeeCents` seraient incompréhen-
   * sibles sur une commande à plusieurs pièces : ce sont des PARTS d'un port
   * et d'une commission uniques, réparties au prorata du prix. À un, la part
   * est le tout et la question ne se pose pas.
   */
  orderLineCount: number
}

export interface SyncShippingBlock {
  /** Poids réel du colis, emballage compris. */
  parcelWeightGrams: number
  /** Palier tarifaire qui couvre ce poids, ou `null` s'il n'y en a plus. */
  tierMaxGrams: number | null
  /** Ce que l'expédition a COÛTÉ, figé sur la commande. */
  carrierCostCents: number
  /** Ce que l'acheteur a PAYÉ pour le port, figé sur la commande. */
  chargedCents: number
}

export interface SyncEventBody {
  event: SyncEventName
  externalId: string
  sku: string
  occurredAt: string
  sale?: SyncSaleBlock
  shipping?: SyncShippingBlock
  price?: { previousCents: number; currentCents: number }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Compose le corps à envoyer, ou `null` si l'événement n'a plus d'objet.
 *
 * `null` n'est pas un échec : une pièce effacée ou détachée de l'application
 * ne se remonte pas, et la réessayer six fois ne la fera pas réapparaître.
 */
export async function buildSyncEventBody(
  payload: SyncNotifyPayload,
): Promise<SyncEventBody | null> {
  const article = await prisma.article.findUnique({
    where: { id: payload.articleId },
    select: { externalId: true, sku: true, priceCents: true },
  })

  if (!article?.externalId) return null

  const body: SyncEventBody = {
    event: payload.event,
    externalId: article.externalId,
    sku: article.sku,
    occurredAt: payload.occurredAt,
  }

  if (payload.event === 'article.price_dropped') {
    // Le prix courant est relu, le prix précédent est transporté : le premier
    // est un fait actuel, le second n'existe plus nulle part une fois la
    // baisse écrite.
    if (payload.previousPriceCents !== undefined) {
      body.price = {
        previousCents: payload.previousPriceCents,
        currentCents: article.priceCents,
      }
    }
    return body
  }

  if (payload.event !== 'article.sold' || !payload.orderId) return body

  const economics = await readSaleEconomics(payload.orderId, payload.articleId)
  if (economics) {
    body.sale = economics.sale
    if (economics.shipping) body.shipping = economics.shipping
  }

  return body
}

/**
 * Part de port, de commission et de marge revenant à une pièce.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il faut répartir
 * ---------------------------------------------------------------------------
 * Le port et la commission de paiement s'appliquent à la COMMANDE : un colis,
 * un encaissement. La remontée porte sur une PIÈCE. Attribuer le port entier à
 * chacune des trois pièces d'une commande triplerait la charge dans les
 * comptes de l'application ; l'attribuer à la première et rien aux autres
 * serait arbitraire sans même l'annoncer.
 *
 * On répartit donc au prorata du prix, par la méthode du plus fort reste, de
 * sorte que les parts fassent exactement le tout. `orderLineCount` dit à
 * l'autre côté qu'il s'agit d'une part.
 *
 * ---------------------------------------------------------------------------
 * La commission est CALCULÉE, pas relevée
 * ---------------------------------------------------------------------------
 * La commission réelle figure sur la transaction de solde Stripe, que nous
 * n'allons pas chercher. Elle est donc recalculée depuis les taux enregistrés
 * en base — les mêmes qui servent au prix plancher. C'est exact tant que les
 * taux le sont, et ils se corrigent en back-office sans redéploiement.
 */
async function readSaleEconomics(
  orderId: string,
  articleId: string,
): Promise<{ sale: SyncSaleBlock; shipping: SyncShippingBlock | null } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      subtotalCents: true,
      shippingCents: true,
      shippingCostCents: true,
      totalCents: true,
      shippingAddress: true,
      shippingCarrierCode: true,
      shippingServiceCode: true,
      items: {
        orderBy: { id: 'asc' },
        select: {
          articleId: true,
          unitPriceCents: true,
          article: { select: { weightGrams: true } },
        },
      },
    },
  })

  if (!order) return null

  const index = order.items.findIndex((item) => item.articleId === articleId)
  if (index < 0) return null

  const line = order.items[index]
  if (!line) return null

  const weights = order.items.map((item) => item.unitPriceCents)
  const pricing = await getPricingConfig()

  // La commission porte sur l'encaissement ENTIER, port compris : c'est ce que
  // le prestataire prélève réellement.
  const orderFeeCents = stripeFeeCents(order.totalCents, pricing)

  const shippingShares = allocateProportionally(order.shippingCents, weights)
  const feeShares = allocateProportionally(orderFeeCents, weights)

  const shippingPaidCents = shippingShares[index] ?? 0
  const paymentFeeCents = feeShares[index] ?? 0

  return {
    sale: {
      priceCents: line.unitPriceCents,
      shippingPaidCents,
      paymentFeeCents,
      // Ce qui reste après les frais de paiement. Le coût transporteur n'en est
      // PAS déduit : il figure à part, dans le bloc `shipping`, et
      // l'application connaît déjà le prix d'achat qu'elle a envoyé. À elle de
      // faire la marge complète, avec des chiffres exacts plutôt qu'un total
      // pré-mâché dont elle ne pourrait pas vérifier la composition.
      netCents: line.unitPriceCents + shippingPaidCents - paymentFeeCents,
      orderLineCount: order.items.length,
    },
    shipping: await readShippingBlock(order),
  }
}

type OrderShippingFacts = {
  subtotalCents: number
  shippingCents: number
  shippingCostCents: number | null
  shippingAddress: unknown
  shippingCarrierCode: string
  shippingServiceCode: string
  items: readonly { article: { weightGrams: number } }[]
}

/**
 * De quoi réconcilier les poids, au fil des ventes.
 *
 * L'application pré-remplit le poids d'une pièce depuis une grille par
 * catégorie, volontairement majorée. Comparer `parcelWeightGrams` à
 * `tierMaxGrams` dit si la pièce FRÔLE une borne de palier — c'est là qu'une
 * sous-estimation coûte cher, parce qu'elle fait basculer le colis dans le
 * palier au-dessus à chaque vente.
 *
 * Renvoie `null` plutôt que d'inventer : une commande sans coût transporteur
 * enregistré, ou une adresse qu'aucune zone ne couvre plus, ne produit pas de
 * bloc. Un chiffre approximatif servirait à calibrer une grille, ce qui est
 * exactement l'usage où il ne faut pas approximer.
 */
async function readShippingBlock(
  order: OrderShippingFacts,
): Promise<SyncShippingBlock | null> {
  if (order.shippingCostCents === null) return null

  // L'adresse figée sur la commande peut avoir été effacée par la purge des
  // données personnelles — dix ans de conservation comptable, mais l'adresse
  // postale, elle, ne fait pas partie de ce qui doit être gardé. Sans pays, la
  // zone est introuvable et le bloc n'est pas construit.
  const country = readPostalAddress(order.shippingAddress).country
  if (!country) return null

  const [config, grids] = await Promise.all([
    getShippingConfig(),
    getShippingGrids(),
  ])

  const parcelWeightGrams = computeParcelWeightGrams(
    order.items.map((item) => item.article.weightGrams),
    config,
  )

  const zone = resolveShippingZone(
    {
      countryCode: country,
      postalCode:
        readPostalAddress(order.shippingAddress).postalCode ?? null,
    },
    grids.zones,
  )

  // Le palier vient de la grille COURANTE, et c'est voulu : la question posée
  // — « ce poids frôle-t-il une borne ? » — porte sur la grille avec laquelle
  // on expédie aujourd'hui, pas sur celle d'il y a six mois.
  const tierMaxGrams = zone.ok
    ? (grids.rates
        .filter(
          (rate) =>
            rate.zoneCode === zone.zone.code &&
            rate.carrierCode === order.shippingCarrierCode &&
            rate.serviceCode === order.shippingServiceCode &&
            rate.maxWeightGrams >= parcelWeightGrams,
        )
        .sort((a, b) => a.maxWeightGrams - b.maxWeightGrams)[0]
        ?.maxWeightGrams ?? null)
    : null

  return {
    parcelWeightGrams,
    tierMaxGrams,
    // Figés sur la commande, eux : ce sont les montants réellement engagés.
    carrierCostCents: order.shippingCostCents,
    chargedCents: order.shippingCents,
  }
}

// ---------------------------------------------------------------------------
// Signature et envoi
// ---------------------------------------------------------------------------

/**
 * Au-delà, on considère l'application indisponible et le travail est repris.
 *
 * Court volontairement : ce travail partage le budget d'un passage de cron avec
 * tous les autres. Une application qui met plus de dix secondes à accuser
 * réception d'un événement d'inventaire est en panne, pas lente.
 */
const DELIVERY_TIMEOUT_MS = 10_000

export class SyncOutboundNotConfiguredError extends Error {
  constructor() {
    super(
      'Remontée vers l’application non configurée : renseignez SYNC_WEBHOOK_URL ' +
        'et SYNC_WEBHOOK_SECRET.',
    )
    this.name = 'SyncOutboundNotConfiguredError'
  }
}

/**
 * Signe `<horodatage>.<corps brut>` en HMAC-SHA256.
 *
 * L'horodatage entre dans le message signé, et pas seulement à côté : sans
 * lui, un appel intercepté resterait valable indéfiniment, puisque sa
 * signature ne dépendrait que d'un corps qui ne change pas. C'est la même
 * construction que celle de Stripe, et pour la même raison.
 *
 * Le corps signé est la chaîne EXACTE qui part sur le réseau. Signer un objet
 * puis le re-sérialiser à l'envoi reviendrait à signer autre chose que ce qui
 * est transmis — l'ordre des clés suffit à faire diverger les deux.
 */
export function signSyncPayload(
  rawBody: string,
  timestampSeconds: number,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex')
}

/**
 * Envoie l'événement. Lève sur tout ce qui n'est pas un `2xx`.
 *
 * Lever EST le mécanisme de reprise : la file rattrape l'erreur, diffère le
 * travail et le rejoue selon l'échelle annoncée au contrat — une minute, cinq,
 * trente, deux heures, six heures.
 */
export async function deliverSyncEvent(
  body: SyncEventBody,
  now: Date = new Date(),
): Promise<void> {
  const url = process.env.SYNC_WEBHOOK_URL
  const secret = process.env.SYNC_WEBHOOK_SECRET
  if (!url || !secret) throw new SyncOutboundNotConfiguredError()

  // `https` exigé : le corps ne porte aucune donnée personnelle, mais il porte
  // des montants et une signature. En clair, les deux se lisent et se rejouent.
  if (!url.startsWith('https://')) {
    throw new Error('SYNC_WEBHOOK_URL doit être une adresse https.')
  }

  const rawBody = JSON.stringify(body)
  const timestamp = Math.floor(now.getTime() / 1000)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nd-timestamp': String(timestamp),
      'x-nd-signature': `sha256=${signSyncPayload(rawBody, timestamp, secret)}`,
    },
    body: rawBody,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    cache: 'no-store',
  })

  if (!response.ok) {
    // Le corps de la réponse est tronqué : il vient d'un tiers, et un message
    // d'erreur de plusieurs kilo-octets remplirait `Job.lastError` sans rien
    // apprendre de plus que son début.
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Remontée refusée par l’application (${response.status}) ${detail.slice(0, 200)}`,
    )
  }
}

/** Point d'entrée du travail `sync.notify`. */
export async function runSyncNotify(payload: unknown): Promise<boolean> {
  const parsed = syncNotifyPayload.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Charge utile invalide pour sync.notify')
  }

  const body = await buildSyncEventBody(parsed.data)

  // Pièce effacée ou détachée de l'application : rien à remonter, et rien à
  // réessayer. Le travail est terminé, pas en échec.
  if (!body) return false

  await deliverSyncEvent(body)
  return true
}
