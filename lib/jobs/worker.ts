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
import { fetchArticleImages } from '@/lib/sync/images'

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

/**
 * Combien de travaux pris à la fois.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un petit paquet plutôt qu'un gros
 * ---------------------------------------------------------------------------
 * `claimJobs` INCRÉMENTE le nombre de tentatives au moment de la prise, pas au
 * moment de l'exécution. Prendre vingt travaux et n'en exécuter que huit avant
 * de manquer de temps brûlerait donc un essai sur les douze autres, sans les
 * avoir essayés. Au cinquième passage, ils seraient abandonnés définitivement.
 *
 * Ce défaut était invisible tant que la file ne portait que des e-mails, qui
 * partent en quelques dizaines de millisecondes. Le réhébergement de dix
 * images, lui, se compte en dizaines de secondes.
 *
 * On prend donc par petits paquets, on les exécute en entier, et on redemande
 * tant qu'il reste du temps. Le dépassement possible est celui d'un seul
 * paquet, pas celui d'un lot entier.
 */
const CHUNK = 4

/**
 * Temps que le passage s'accorde pour prendre de NOUVEAUX travaux.
 *
 * Confortablement sous la durée maximale de la fonction de cron
 * (`maxDuration`), et sous ce que peuvent tenir les autres travaux périodiques
 * qui partagent la même requête. Ce n'est pas une limite d'exécution : un
 * travail commencé va jusqu'au bout.
 */
const CLAIM_BUDGET_MS = 35_000

export interface WorkerReport {
  claimed: number
  done: number
  failed: number
}

export async function runJobs(
  now = new Date(),
  budgetMs: number = CLAIM_BUDGET_MS,
): Promise<WorkerReport> {
  // Identifiant d'exécutant : sert uniquement au diagnostic, pour savoir qui
  // tenait un verrou resté ouvert.
  const workerId = randomUUID()
  const deadline = Date.now() + budgetMs

  let claimed = 0
  let done = 0
  let failed = 0

  while (Date.now() < deadline) {
    const jobs = await claimJobs(workerId, CHUNK, now)
    if (jobs.length === 0) break

    claimed += jobs.length

    for (const job of jobs) {
      try {
        await runOne(job)
        await completeJob(job.id)
        done += 1
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'erreur inconnue'
        // Le nombre de tentatives décide du délai de reprise : sans lui, un
        // travail en échec serait repris dans le même passage, et ses cinq
        // essais partiraient en quelques secondes.
        await failJob(job.id, message, job.attempts)
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
  }

  return { claimed, done, failed }
}

async function runOne(job: JobRecord): Promise<void> {
  switch (job.type) {
    case 'order.confirmation':
      return runOrderEmail(job, sendOrderConfirmation)
    case 'order.notify-shop':
      return runOrderEmail(job, sendShopNotification)
    case 'article.images':
      // La valeur de retour ne sert qu'au diagnostic : ce qui compte est que
      // le travail ne lève pas. Une pièce introuvable renvoie `null` et le
      // travail est marqué terminé — réessayer cinq fois de télécharger les
      // photos d'un article effacé ne le fera pas réapparaître.
      await fetchArticleImages(job.payload)
      return
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
