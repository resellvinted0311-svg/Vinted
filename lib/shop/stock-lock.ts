import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { getSetting } from '@/lib/config/settings'

/**
 * Verrou de stock.
 *
 * C'est la pièce critique de la Phase 2. Le stock est unitaire : il n'existe
 * qu'un exemplaire de chaque article. Deux personnes qui cliquent sur « Payer »
 * à la même milliseconde ne doivent pas toutes deux atteindre Stripe.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi UN SEUL « UPDATE … WHERE … RETURNING »
 * ---------------------------------------------------------------------------
 * Sous READ COMMITTED — l'isolation par défaut de PostgreSQL — un `UPDATE`
 * pose le verrou de ligne PUIS réévalue sa clause `WHERE` sur la version à jour
 * de la ligne. Deux transactions concurrentes visant le même article sont donc
 * sérialisées par le moteur lui-même : la perdante constate que la ligne ne
 * satisfait plus la condition et met à jour ZÉRO ligne.
 *
 * Un `findFirst` suivi d'un `update` n'offre rien de tel. Les deux lectures
 * passent avant la première écriture, les deux se croient gagnantes, et le test
 * de concurrence ne passe que par chance selon l'ordonnancement.
 *
 * Le `RETURNING` n'est pas décoratif : c'est lui qui dit ce qui a réellement
 * été verrouillé. Ne pas comparer ce décompte au nombre demandé, c'est laisser
 * quelqu'un payer un article déjà vendu à un autre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un verrou consultatif par propriétaire
 * ---------------------------------------------------------------------------
 * La clause admet de re-prendre un verrou qu'on détient déjà : sans cela, un
 * rechargement de page ou une reprise de paiement échouerait sur son propre
 * verrou.
 *
 * Mais cette tolérance, seule, ouvre une faille : deux clics simultanés depuis
 * le MÊME navigateur — double-clic, deux onglets — passent tous deux, et
 * produisent deux paiements vivants sur le même exemplaire. Le verrou
 * consultatif, pris sur le propriétaire au début de la transaction, sérialise
 * ces tentatives-là. L'exclusion entre propriétaires DIFFÉRENTS reste assurée
 * par la mise à jour conditionnelle elle-même.
 */

/** Résultat d'une prise de verrou. */
export type StockLockResult =
  | { ok: true; until: Date }
  | { ok: false; unavailableArticleIds: string[] }

/**
 * Sérialise les tentatives d'un même propriétaire.
 *
 * `pg_advisory_xact_lock` est relâché automatiquement à la fin de la
 * transaction — y compris si elle échoue, y compris si le processus meurt. Un
 * verrou applicatif qu'il faudrait relâcher à la main laisserait un article
 * immobilisé pour toujours au premier plantage.
 */
export async function serializeOwner(
  tx: Prisma.TransactionClient,
  ownerId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`
}

/**
 * Prend le verrou sur tous les articles, ou sur aucun.
 *
 * À appeler DANS la transaction qui crée la commande, avant toute création
 * d'intention de paiement. Réserver plus tôt — à l'ajout au panier, à
 * l'ouverture d'une fiche — immobiliserait le catalogue pour des paniers
 * abandonnés.
 *
 * Le tout ou rien est délibéré : verrouiller partiellement laisserait la
 * personne payer trois articles sur quatre sans jamais l'avoir accepté.
 */
export async function acquireStockLocks(
  tx: Prisma.TransactionClient,
  input: { articleIds: readonly string[]; ownerId: string; ttlMinutes: number },
): Promise<StockLockResult> {
  const ids = [...new Set(input.articleIds)]
  if (ids.length === 0) return { ok: false, unavailableArticleIds: [] }

  // Ré-entrant : si l'appelante l'a déjà pris, ceci ne coûte rien.
  await serializeOwner(tx, input.ownerId)

  // L'échéance est calculée PAR LA BASE, jamais par le serveur applicatif.
  //
  // L'expiration se teste ailleurs avec `now()`, c'est-à-dire l'horloge de
  // PostgreSQL. Poser l'échéance avec `Date.now()` ferait cohabiter deux
  // horloges : sur une fonction serverless dont l'horloge dérive de quelques
  // secondes — cela arrive — un verrou expirerait avant l'heure et libérerait
  // un article pendant que son acheteur est sur la page de paiement, ou
  // survivrait au-delà et l'immobiliserait pour rien.
  //
  // Une seule instruction. Les trois branches du WHERE :
  //   - AVAILABLE                       : libre ;
  //   - RESERVED expiré                 : le balayage n'est pas passé, la
  //                                       réservation ne vaut plus rien ;
  //   - RESERVED par le même propriétaire : reprise de son propre paiement.
  //
  // `status = 'RESERVED'` et non 'SOLD' : une pièce vendue ne se reprend
  // jamais, même par celui qui l'avait réservée.
  const locked = await tx.$queryRaw<{ id: string; reservedUntil: Date }[]>`
    UPDATE "Article"
    SET "status" = 'RESERVED',
        "reservedById" = ${input.ownerId},
        "reservedUntil" = now() + make_interval(mins => ${input.ttlMinutes}::int),
        "updatedAt" = now()
    WHERE "id" = ANY(${ids}::text[])
      AND "publishedAt" IS NOT NULL
      AND (
        "status" = 'AVAILABLE'
        OR (
          "status" = 'RESERVED'
          AND ("reservedUntil" < now() OR "reservedById" = ${input.ownerId})
        )
      )
    RETURNING "id", "reservedUntil"
  `

  if (locked.length !== ids.length) {
    const lockedIds = new Set(locked.map((row) => row.id))
    return {
      ok: false,
      unavailableArticleIds: ids.filter((id) => !lockedIds.has(id)),
    }
  }

  // L'échéance renvoyée est celle réellement inscrite, relue de la base.
  const until = locked[0]?.reservedUntil
  if (!until) {
    return { ok: false, unavailableArticleIds: ids }
  }

  return { ok: true, until }
}

/**
 * Relâche les verrous d'un propriétaire.
 *
 * `reservedById = owner` n'est pas une précaution de style : sans cette
 * condition, un abandon tardif libérerait le verrou que quelqu'un d'autre vient
 * de prendre sur le même article — et deux personnes se retrouveraient à payer.
 *
 * Ne touche jamais un article vendu : une vente conclue n'est pas un verrou.
 */
export async function releaseStockLocks(
  tx: Prisma.TransactionClient,
  input: { articleIds: readonly string[]; ownerId: string },
): Promise<number> {
  const ids = [...new Set(input.articleIds)]
  if (ids.length === 0) return 0

  return tx.$executeRaw`
    UPDATE "Article"
    SET "status" = 'AVAILABLE',
        "reservedById" = NULL,
        "reservedUntil" = NULL,
        "updatedAt" = now()
    WHERE "id" = ANY(${ids}::text[])
      AND "status" = 'RESERVED'
      AND "reservedById" = ${input.ownerId}
  `
}

/**
 * Libère les réservations échues.
 *
 * Idempotent par construction : la condition porte sur l'échéance, donc une
 * seconde exécution ne trouve plus rien à faire. Deux exécutions qui se
 * chevauchent ne peuvent pas se nuire — la première verrouille les lignes, la
 * seconde les voit déjà libérées et n'en compte aucune.
 *
 * Ne touche pas les articles vendus : leur `reservedUntil` a beau être passé,
 * ils ne redeviennent pas disponibles.
 */
export async function releaseExpiredStockLocks(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Article"
    SET "status" = 'AVAILABLE',
        "reservedById" = NULL,
        "reservedUntil" = NULL,
        "updatedAt" = now()
    WHERE "status" = 'RESERVED'
      AND "reservedUntil" IS NOT NULL
      AND "reservedUntil" < now()
  `
}

/** Durée de vie d'une réservation, lue en base. Jamais codée en dur. */
export async function getReservationTtlMinutes(): Promise<number> {
  return getSetting('reservationTtlMinutes')
}
