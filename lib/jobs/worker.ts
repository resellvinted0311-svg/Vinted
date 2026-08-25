import 'server-only'

import { randomUUID } from 'node:crypto'
import { captureException } from '@/lib/observability/sentry'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import {
  claimJob,
  claimJobs,
  completeJob,
  failJob,
  MAX_ATTEMPTS,
  type JobRecord,
} from './queue'
import { localeSchema } from '@/lib/validation/auth'
import { openPasswordReset } from '@/lib/auth/password-reset'
import { sendPasswordResetEmail } from '@/lib/providers/email/password-reset'
import {
  sendOrderConfirmation,
  sendShipmentNotice,
  sendShopNotification,
  type OrderEmailData,
} from '@/lib/providers/email/order'
import {
  sendOfferAcknowledgement,
  sendOfferShopNotice,
  type OfferEmailData,
} from '@/lib/providers/email/offer'
import { readOfferEmailData } from '@/lib/shop/offers'
import { fetchArticleImages } from '@/lib/sync/images'
import { runSyncNotify } from '@/lib/sync/webhook'

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
const offerJobPayload = z.object({ offerId: z.string().min(1).max(64) })

/**
 * La langue est validée contre la liste des langues du site, pas acceptée
 * telle quelle : elle est interpolée dans le chemin de l'URL du lien
 * (`/{locale}/connexion/mot-de-passe/{jeton}`). `Job.payload` est une colonne
 * `Json` — un jour, quelqu'un y écrira à la main pour rejouer un travail.
 */
const passwordResetJobPayload = z.object({
  userId: z.string().min(1).max(64),
  locale: localeSchema,
})

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
          // Remonté, pas seulement journalisé : un travail épuisé est un
          // e-mail qui ne partira jamais, et personne ne s'en apercevrait.
          await captureException(error, {
            event: 'jobs.exhausted',
            fields: { jobType: job.type, jobId: job.id, attempts: job.attempts },
          })
        }
      }
    }
  }

  return { claimed, done, failed }
}

/**
 * Exécute TOUT DE SUITE un travail qu'on vient d'inscrire.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce chemin existe à côté du cron
 * ---------------------------------------------------------------------------
 * Le cron passe toutes les cinq minutes. Pour un lien de réinitialisation, c'est
 * une éternité : la personne attend devant son écran, ne voit rien arriver, et
 * reclique. Or le compteur par adresse est à trois par heure — au troisième
 * clic elle serait plafonnée en silence et ne recevrait plus rien du tout. Une
 * correction de sécurité qui enferme les gens dehors n'est pas une correction.
 *
 * À appeler APRÈS avoir répondu, jamais avant : c'est tout l'intérêt. Le travail
 * reste inscrit en file et c'est elle qui fait foi — si cet appel n'a pas lieu,
 * ou échoue, le cron reprendra le travail comme n'importe quel autre.
 *
 * ---------------------------------------------------------------------------
 * Ne lève JAMAIS
 * ---------------------------------------------------------------------------
 * Elle est appelée une fois la réponse partie, où plus personne n'attend de
 * valeur de retour ni ne recevrait une exception. Une promesse rejetée là
 * termine en `unhandledRejection` — sur certaines plateformes, cela tue le
 * processus, et avec lui les requêtes des autres visiteurs servies par la même
 * instance.
 *
 * Le travail épuisé n'est pas remonté ici : c'est `runJobs` qui le fait, et il
 * le fera, puisqu'un travail que ce chemin n'a pas su terminer retourne en file.
 */
export async function runJobNow(id: string): Promise<boolean> {
  try {
    const job = await claimJob(randomUUID(), id)

    // Déjà pris — par le cron, ou par un second envoi du même formulaire. Ce
    // n'est pas une anomalie : c'est l'UPDATE conditionnel qui a fait son
    // travail, et l'e-mail ne partira qu'une fois.
    if (!job) return false

    try {
      await runOne(job)
      await completeJob(job.id)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erreur inconnue'
      await failJob(job.id, message, job.attempts)
      return false
    }
  } catch {
    // Base injoignable, verrou perdu : le travail reste ouvert en file, et le
    // cron le reprendra. Il n'y a rien de mieux à faire ici, et surtout rien à
    // laisser remonter.
    return false
  }
}

async function runOne(job: JobRecord): Promise<void> {
  switch (job.type) {
    case 'order.confirmation':
      return runOrderEmail(job, sendOrderConfirmation)
    case 'order.notify-shop':
      return runOrderEmail(job, sendShopNotification)
    case 'order.shipped':
      return runShipmentNotice(job)
    case 'offer.acknowledge':
      return runOfferEmail(job, sendOfferAcknowledgement)
    case 'offer.notify-shop':
      return runOfferEmail(job, sendOfferShopNotice)
    // La réponse du vendeur emprunte le MÊME gabarit que l'accusé de dépôt :
    // il se compose déjà à partir du statut relu de l'offre, donc il dit
    // « acceptée » ou « refusée » sans rien avoir à lui apprendre.
    case 'offer.respond':
      return runOfferEmail(job, sendOfferAcknowledgement)
    case 'auth.password-reset':
      return runPasswordResetEmail(job)
    case 'sync.notify':
      // Une pièce effacée ou détachée de l'application renvoie `false` : le
      // travail est terminé, pas en échec. Tout le reste — application
      // indisponible, réponse non `2xx` — lève, et la file reprend selon
      // l'échelle annoncée au contrat.
      await runSyncNotify(job.payload)
      return
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

/**
 * E-mails de négociation.
 *
 * Même patron que ceux de commande : la charge utile ne porte qu'un
 * identifiant, et le contenu est relu à l'exécution. Une offre acceptée entre
 * l'inscription et l'envoi doit produire l'accusé de l'ACCEPTATION, pas celui
 * de la proposition qu'on avait figée en file.
 */
async function runOfferEmail(
  job: JobRecord,
  send: (data: OfferEmailData) => Promise<void>,
): Promise<void> {
  const parsed = offerJobPayload.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Charge utile invalide pour ${job.type}`)
  }

  const data = await readOfferEmailData(parsed.data.offerId)

  // Offre disparue, ou sans destinataire : rien à envoyer, et rien à
  // réessayer.
  if (!data) return

  await send(data)
}

/**
 * Le lien de réinitialisation de mot de passe.
 *
 * ---------------------------------------------------------------------------
 * Le jeton est créé ICI, pas au moment de la demande
 * ---------------------------------------------------------------------------
 * C'est ce qui permet à `Job.payload` de ne porter qu'un identifiant de compte.
 * Créer le jeton à la demande aurait obligé à le faire voyager en clair dans la
 * file — une colonne `Json` conservée un mois, alors que `UserToken` ne garde
 * qu'une empreinte précisément pour qu'une sauvegarde égarée n'ouvre aucun
 * compte.
 *
 * Effet de bord heureux : les trente minutes de validité courent à partir de
 * l'ENVOI, pas de la demande. Le lien ne perd plus le temps passé en file.
 *
 * ---------------------------------------------------------------------------
 * L'adresse est relue, jamais transportée
 * ---------------------------------------------------------------------------
 * Même patron que les e-mails de commande et de négociation : la charge utile
 * ne porte qu'un identifiant, le contenu se relit à l'exécution. Ici cela a une
 * seconde vertu — l'adresse e-mail ne s'écrit nulle part dans `Job`, qui est
 * déclarée au registre comme ne portant que des identifiants internes.
 */
async function runPasswordResetEmail(job: JobRecord): Promise<void> {
  const parsed = passwordResetJobPayload.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Charge utile invalide pour ${job.type}`)
  }

  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, anonymizedAt: null },
    select: { id: true, email: true },
  })

  // Compte effacé entre la demande et l'envoi : rien à envoyer, et rien à
  // réessayer. Poser un lien de réinitialisation sur une ligne anonymisée la
  // ferait revivre — c'est exactement le défaut qu'un jeton de vérification
  // survivant avait déjà produit une fois, et qui recréait un compte supprimé.
  if (!user) return

  const request = await openPasswordReset(user.id, parsed.data.locale)

  await sendPasswordResetEmail({
    to: user.email,
    url: request.url,
    expires: request.expiresAt,
  })
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
/**
 * L'avis d'expédition, relu au moment de partir.
 *
 * Une fonction à part plutôt qu'un champ de plus sur `OrderEmailData` : cet
 * e-mail ne porte NI montants, NI lignes de commande, NI numéro de facture.
 * Il annonce un départ et donne un numéro à suivre. Réutiliser la charge de la
 * confirmation ferait voyager tout le reste jusqu'au gabarit, où il suffirait
 * d'une ligne distraite pour le faire réapparaître.
 *
 * Le suivi vient de la ligne `Shipment` la plus récente. Il n'y en a pas
 * toujours — une expédition sans numéro exploitable n'en crée aucune — et le
 * gabarit le dit alors franchement plutôt que de laisser un blanc.
 */
async function runShipmentNotice(job: JobRecord): Promise<void> {
  const parsed = orderJobPayload.safeParse(job.payload)
  if (!parsed.success) {
    throw new Error(`Charge utile invalide pour ${job.type}`)
  }

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    select: {
      orderNumber: true,
      locale: true,
      email: true,
      shippingAddress: true,
      shipments: {
        select: { trackingNumber: true, trackingUrl: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  // Commande disparue : rien à envoyer, et rien à réessayer.
  if (!order) return

  const shipment = order.shipments[0] ?? null

  await sendShipmentNotice({
    orderNumber: order.orderNumber,
    locale: order.locale,
    email: order.email,
    trackingNumber: shipment?.trackingNumber ?? null,
    trackingUrl: shipment?.trackingUrl ?? null,
    shipping: readShippingAddress(order.shippingAddress),
  })
}

/** L'adresse figée, lue défensivement : c'est une colonne `Json`. */
function readShippingAddress(value: unknown): OrderEmailData['shipping'] {
  const shipping =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  const text = (key: string): string | undefined =>
    typeof shipping[key] === 'string' && shipping[key] !== ''
      ? (shipping[key] as string)
      : undefined

  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    line1: text('line1'),
    line2: text('line2'),
    postalCode: text('postalCode'),
    city: text('city'),
    country: text('country'),
  }
}

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
