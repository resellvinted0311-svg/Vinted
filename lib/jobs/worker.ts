import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import {
  claimJobs,
  completeJob,
  failJob,
  MAX_ATTEMPTS,
  type JobRecord,
} from './queue'
import {
  sendOrderConfirmation,
  sendShopNotification,
  type OrderEmailData,
} from '@/lib/providers/email/order'

/**
 * Exécution des travaux différés.
 *
 * ---------------------------------------------------------------------------
 * Le contenu se relit, il ne se transporte pas
 * ---------------------------------------------------------------------------
 * La charge utile d'un travail ne contient qu'un identifiant de commande.
 * Recopier les lignes, les montants et l'adresse au moment de l'inscription
 * les figerait deux fois — une fois sur la commande, une fois dans le
 * travail — et les deux copies finiraient par diverger, par exemple si un
 * numéro de facture est attribué entre les deux.
 *
 * On relit donc la commande à l'exécution. Elle porte déjà ses propres
 * instantanés : ce sont eux qui font foi.
 *
 * ---------------------------------------------------------------------------
 * Une commande introuvable n'est pas un échec à réessayer
 * ---------------------------------------------------------------------------
 * Réessayer cinq fois d'envoyer la confirmation d'une commande effacée ne la
 * fera pas réapparaître. Ces cas-là sont marqués terminés, pas remis en file.
 */

const orderJobPayload = z.object({ orderId: z.string().min(1).max(64) })

/** Combien de travaux au plus par passage. */
const BATCH = 20

export interface WorkerReport {
  claimed: number
  done: number
  failed: number
}

export async function runJobs(now = new Date()): Promise<WorkerReport> {
  // Identifiant d'exécutant : sert uniquement au diagnostic, pour savoir qui
  // tenait un verrou resté ouvert.
  const workerId = randomUUID()
  const jobs = await claimJobs(workerId, BATCH, now)

  let done = 0
  let failed = 0

  for (const job of jobs) {
    try {
      await runOne(job)
      await completeJob(job.id)
      done += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erreur inconnue'
      await failJob(job.id, message)
      failed += 1

      // Bruyant au dernier essai seulement : les échecs transitoires — un
      // prestataire d'e-mail indisponible trente secondes — n'ont pas à
      // remplir les journaux.
      if (job.attempts >= MAX_ATTEMPTS) {
        console.error(
          `[jobs] ${job.type} abandonné après ${job.attempts} tentatives :`,
          message,
        )
      }
    }
  }

  return { claimed: jobs.length, done, failed }
}

async function runOne(job: JobRecord): Promise<void> {
  switch (job.type) {
    case 'order.confirmation':
      return runOrderEmail(job, sendOrderConfirmation)
    case 'order.notify-shop':
      return runOrderEmail(job, sendShopNotification)
    default:
      // Type inconnu : probablement un travail inscrit par une version plus
      // récente du code, sur un déploiement en cours de bascule. On le laisse
      // échouer proprement plutôt que de le marquer terminé et de le perdre.
      throw new Error(`Type de travail inconnu : ${job.type}`)
  }
}

async function runOrderEmail(
  job: JobRecord,
  send: (data: OrderEmailData) => Promise<void>,
): Promise<void> {
  const parsed = orderJobPayload.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Charge utile invalide pour ${job.type}`)
  }

  const data = await readOrderEmailData(parsed.data.orderId)

  // Commande disparue : rien à envoyer, et rien à réessayer.
  if (!data) return

  await send(data)
}

/** Relit la commande sous la forme qu'attendent les gabarits d'e-mail. */
async function readOrderEmailData(
  orderId: string,
): Promise<OrderEmailData | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      locale: true,
      email: true,
      subtotalCents: true,
      discountCents: true,
      shippingCents: true,
      totalCents: true,
      shippingAddress: true,
      invoiceNumber: true,
      items: {
        select: {
          titleSnapshot: true,
          unitPriceCents: true,
          article: { select: { sku: true } },
        },
      },
    },
  })

  if (!order) return null

  const shipping =
    order.shippingAddress && typeof order.shippingAddress === 'object'
      ? (order.shippingAddress as Record<string, unknown>)
      : {}

  const text = (key: string): string | undefined =>
    typeof shipping[key] === 'string' && shipping[key] !== ''
      ? (shipping[key] as string)
      : undefined

  return {
    orderNumber: order.orderNumber,
    locale: order.locale,
    email: order.email,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    invoiceNumber: order.invoiceNumber,
    lines: order.items.map((item) => ({
      title: item.titleSnapshot,
      reference: item.article?.sku ?? null,
      unitPriceCents: item.unitPriceCents,
    })),
    shipping: {
      firstName: text('firstName'),
      lastName: text('lastName'),
      line1: text('line1'),
      line2: text('line2'),
      postalCode: text('postalCode'),
      city: text('city'),
      country: text('country'),
    },
  }
}
