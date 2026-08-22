import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

/**
 * File de travaux différés.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ne pas simplement envoyer l'e-mail dans le webhook
 * ---------------------------------------------------------------------------
 * Parce qu'un envoi d'e-mail est un appel réseau, et qu'un appel réseau
 * échoue. Trois façons de mal faire, toutes tentantes :
 *
 *  - envoyer DANS la transaction : on tient des verrous de base pendant qu'on
 *    attend un tiers, et un e-mail parti ne se rembobine pas si la transaction
 *    échoue ensuite ;
 *  - envoyer après la transaction, en attendant : le webhook répond en trois
 *    secondes au lieu de cinquante millisecondes, et une panne du prestataire
 *    d'e-mail fait échouer le webhook. Stripe rejoue, la vente est déjà
 *    enregistrée, mais l'e-mail repart — ou pas ;
 *  - envoyer sans attendre, en oubliant la promesse : sur une fonction
 *    serverless, le processus est gelé dès la réponse renvoyée. L'e-mail n'est
 *    jamais parti, et personne ne le sait.
 *
 * On inscrit donc l'intention en base, dans la MÊME transaction que la vente.
 * Si la vente est enregistrée, l'e-mail est dû ; si elle échoue, il ne l'est
 * pas. La tâche planifiée s'en occupe ensuite, avec des reprises.
 *
 * ---------------------------------------------------------------------------
 * Verrou de traitement
 * ---------------------------------------------------------------------------
 * Deux exécutions du cron peuvent se chevaucher — Vercel n'en garantit pas
 * l'exclusion. Sans verrou, les deux prendraient les mêmes travaux et
 * enverraient chaque e-mail deux fois. La prise se fait par un UPDATE
 * conditionnel qui renvoie ce qu'il a réellement pris, jamais par un SELECT
 * suivi d'un UPDATE.
 */

export type JobType =
  | 'order.confirmation'
  | 'order.notify-shop'

export interface JobRecord {
  id: string
  type: string
  payload: unknown
  attempts: number
}

/**
 * Au-delà, on cesse de réessayer.
 *
 * Un travail qui échoue cinq fois n'échoue pas par hasard : il échoue parce
 * que quelque chose est cassé, et le réessayer indéfiniment noierait les
 * journaux au lieu d'attirer l'attention.
 */
export const MAX_ATTEMPTS = 5

/** Un travail bloqué plus longtemps que cela a perdu son exécutant. */
const LOCK_TIMEOUT_MINUTES = 15

/**
 * Inscrit un travail. À appeler dans la transaction métier.
 *
 * `runAt` permet de différer : une relance de panier abandonné se programme à
 * l'avance, elle ne se déclenche pas tout de suite.
 */
export async function enqueue(
  tx: Prisma.TransactionClient,
  input: { type: JobType; payload: Prisma.InputJsonValue; runAt?: Date },
): Promise<void> {
  await tx.job.create({
    data: {
      type: input.type,
      payload: input.payload,
      runAt: input.runAt ?? new Date(),
    },
  })
}

/**
 * Prend un lot de travaux exigibles, en les verrouillant.
 *
 * Le verrou est posé par l'UPDATE lui-même : deux exécutions concurrentes ne
 * peuvent pas prendre le même travail, la seconde ne le voit simplement plus.
 */
export async function claimJobs(
  workerId: string,
  limit: number,
  now = new Date(),
): Promise<JobRecord[]> {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MINUTES * 60_000)

  return prisma.$queryRaw<JobRecord[]>`
    UPDATE "Job"
    SET "lockedAt" = now(),
        "lockedBy" = ${workerId},
        "attempts" = "attempts" + 1,
        "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE "completedAt" IS NULL
        AND "runAt" <= ${now}
        AND "attempts" < ${MAX_ATTEMPTS}
        AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      -- Sans SKIP LOCKED, deux exécutions concurrentes s'attendraient l'une
      -- l'autre sur les mêmes lignes au lieu de se partager le travail.
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts"
  `
}

/** Marque un travail terminé. Il ne sera plus repris. */
export async function completeJob(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  })
}

/**
 * Enregistre un échec et rend le travail reprenable.
 *
 * Le verrou est relâché immédiatement : le nombre de tentatives, lui, a déjà
 * été incrémenté à la prise. C'est lui qui finit par arrêter les frais.
 */
export async function failJob(id: string, error: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: {
      lockedAt: null,
      lockedBy: null,
      // Tronqué : un message d'erreur de bibliothèque peut faire des milliers
      // de caractères, et seul son début renseigne.
      lastError: error.slice(0, 500),
    },
  })
}

/** Travaux définitivement abandonnés, pour qu'ils ne passent pas inaperçus. */
export async function countExhaustedJobs(): Promise<number> {
  return prisma.job.count({
    where: { completedAt: null, attempts: { gte: MAX_ATTEMPTS } },
  })
}
