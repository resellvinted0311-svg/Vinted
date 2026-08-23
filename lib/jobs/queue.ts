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
  /**
   * Téléchargement et réhébergement des visuels d'une pièce importée.
   *
   * Différé pour une raison de temps, pas de confort : trois cents images dans
   * l'appel d'import dépasseraient le temps imparti à une fonction serverless,
   * et l'application de gestion attendrait une réponse qui n'arriverait jamais.
   */
  | 'article.images'
  /**
   * Remontée d'un changement d'état vers l'application de gestion.
   *
   * Différée pour la même raison que les e-mails : la vente est inscrite dans
   * la transaction qui l'enregistre, l'appel réseau vient après. Une
   * application de gestion indisponible ne doit jamais faire échouer un
   * paiement encaissé.
   */
  | 'sync.notify'

export interface JobRecord {
  id: string
  type: string
  payload: unknown
  attempts: number
}

/**
 * Au-delà, on cesse de réessayer.
 *
 * Un travail qui échoue six fois n'échoue pas par hasard : il échoue parce que
 * quelque chose est cassé, et le réessayer indéfiniment noierait les journaux
 * au lieu d'attirer l'attention.
 *
 * Six et non cinq : le contrat de synchronisation annonce à l'application de
 * gestion cinq reprises — une minute, cinq, trente, deux heures, six heures.
 * Cinq reprises supposent six tentatives. Promettre l'une et en faire quatre
 * aurait fait abandonner en silence des remontées de vente que l'autre côté
 * attendait encore.
 */
export const MAX_ATTEMPTS = 6

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
 * Délais de reprise, en minutes, selon le nombre de tentatives déjà faites.
 *
 * Ce sont exactement ceux que `docs/synchronisation.md` annonce à
 * l'application de gestion : « 1 min, 5 min, 30 min, 2 h, 6 h ». Les e-mails
 * suivent la même échelle — rien ne justifiait deux tables.
 *
 * Au-delà de la liste, on garde le dernier délai — jusqu'à `MAX_ATTEMPTS`, qui
 * arrête les frais.
 */
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360] as const

/**
 * Enregistre un échec et reprogramme le travail.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une reprise DIFFÉRÉE, et non immédiate
 * ---------------------------------------------------------------------------
 * Le verrou était relâché sans toucher à `runAt`, ce qui rendait le travail
 * immédiatement reprenable. Tant que l'exécutant ne prenait qu'un paquet par
 * passage, cela n'avait pas d'effet visible : la reprise tombait au passage
 * suivant du cron, cinq minutes plus tard.
 *
 * Depuis que l'exécutant redemande du travail tant qu'il lui reste du temps,
 * ce n'est plus vrai : un travail qui échoue est repris DANS LE MÊME PASSAGE,
 * et ses cinq tentatives sont brûlées en quelques secondes. Un prestataire
 * d'e-mail indisponible trente secondes suffirait alors à perdre définitivement
 * une confirmation de commande.
 *
 * Les délais croissent — une minute, cinq, trente, deux heures — parce que la
 * cause d'un échec change de nature avec le temps : les premières reprises
 * visent un incident passager, les dernières un incident qu'il a fallu réparer.
 */
export async function failJob(
  id: string,
  error: string,
  attempts = 1,
): Promise<void> {
  const index = Math.min(
    Math.max(attempts, 1),
    RETRY_DELAYS_MINUTES.length,
  ) - 1
  const delayMinutes = RETRY_DELAYS_MINUTES[index] ?? 120

  // L'échéance est calculée PAR LA BASE. C'est la même horloge que celle qui
  // décide, à la prise, si un travail est exigible — deux horloges feraient
  // reprendre trop tôt ou jamais.
  await prisma.$executeRaw`
    UPDATE "Job"
    SET "lockedAt" = NULL,
        "lockedBy" = NULL,
        -- Tronqué : un message d'erreur de bibliothèque peut faire des
        -- milliers de caractères, et seul son début renseigne.
        "lastError" = ${error.slice(0, 500)},
        "runAt" = now() + make_interval(mins => ${delayMinutes}::int),
        "updatedAt" = now()
    WHERE "id" = ${id}
  `
}

/** Travaux définitivement abandonnés, pour qu'ils ne passent pas inaperçus. */
export async function countExhaustedJobs(): Promise<number> {
  return prisma.job.count({
    where: { completedAt: null, attempts: { gte: MAX_ATTEMPTS } },
  })
}
