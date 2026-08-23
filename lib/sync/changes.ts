import 'server-only'

import { prisma } from '@/lib/db/client'

/**
 * Filet de rattrapage — `GET /api/sync/changes`.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un état, et non un journal d'événements
 * ---------------------------------------------------------------------------
 * La remontée par appel signé peut échouer : application éteinte une semaine,
 * secret expiré, adresse changée. Le contrat promet alors que « rien ne se
 * perd ».
 *
 * Un journal d'événements tiendrait cette promesse au prix d'une table de plus,
 * qui grossit sans fin et qu'il faudrait purger — c'est-à-dire recommencer à
 * perdre. On renvoie donc l'ÉTAT COURANT des pièces modifiées depuis une date.
 *
 * La différence compte : un état est idempotent. Rejouer la même fenêtre deux
 * fois ne produit rien de nouveau, et une application qui a manqué trois
 * transitions successives reçoit la dernière, qui est la seule vraie. Un
 * journal, lui, lui ferait rejouer trois fois une histoire dont seule la fin
 * l'intéresse.
 *
 * Ce qui est perdu par ce choix, et qu'il faut dire : l'HISTOIRE. Une pièce
 * réservée puis libérée puis revendue dans la même fenêtre ne remonte qu'une
 * fois, dans son état final. Pour l'inventaire, c'est exactement ce qu'il faut.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi les échecs d'image y figurent
 * ---------------------------------------------------------------------------
 * Une pièce importée dont tous les visuels ont échoué reste en brouillon,
 * invisible, et l'application n'a aucun moyen de le savoir : son import a
 * répondu `created`. Le contrat prévoit qu'elle apparaisse ici avec le motif.
 *
 * Le motif est lu sur le travail de la file, là où l'échec s'est produit.
 * `lib/privacy/retention.ts` ne purge jamais un travail en échec, précisément
 * pour que cette information survive.
 */

/** Au-delà, on pagine. Une semaine d'arrêt peut faire beaucoup de pièces. */
export const CHANGES_PAGE_SIZE = 200

export interface SyncChange {
  externalId: string
  sku: string
  slug: string
  /** État de vente, tel que la boutique le connaît à cet instant. */
  status: string
  priceCents: number
  publishedAt: string | null
  soldAt: string | null
  reservedUntil: string | null
  updatedAt: string
  /** Aucune image stockée : la fiche attend ses visuels. */
  imagesPending: boolean
  /** Dernière erreur de téléchargement des visuels, si elle existe. */
  imagesError: string | null
}

export interface SyncChangesPage {
  changes: SyncChange[]
  /**
   * Date à passer en `since` au prochain appel.
   *
   * Toujours renvoyée, y compris sur une page vide : c'est elle qui fait
   * avancer le curseur, et une application qui repartirait de sa propre date
   * relirait indéfiniment la même fenêtre.
   */
  nextSince: string
  /**
   * `externalId` à passer en `after` avec `nextSince`.
   *
   * Les deux vont ensemble : `since` seul rendrait de nouveau les pièces
   * modifiées à la même milliseconde que la dernière rendue.
   */
  nextAfter: string | null
  /** Reste-t-il des changements après cette page ? */
  hasMore: boolean
}

interface ChangeRow {
  externalId: string
  sku: string
  slug: string
  status: string
  priceCents: number
  publishedAt: Date | null
  soldAt: Date | null
  reservedUntil: Date | null
  updatedAt: Date
  imageCount: number
  imagesError: string | null
}

/**
 * Les pièces connues de l'application, modifiées depuis `since`.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un curseur sur `(updatedAt, externalId)` et non sur la seule date
 * ---------------------------------------------------------------------------
 * Deux cents pièces importées dans le même lot partagent souvent la même
 * milliseconde de modification. Un curseur sur la seule date en sauterait une
 * partie — celles qui tombent après la coupure mais portent la même valeur —
 * ou les renverrait indéfiniment. La comparaison de n-uplets règle les deux
 * cas, et c'est déjà le patron de pagination du catalogue.
 *
 * Le départage se fait sur `externalId` et non sur l'identifiant interne :
 * l'application connaît le premier, elle n'a rien à faire du second, et un
 * curseur qu'on peut relire vaut mieux qu'un jeton opaque de plus.
 */
export async function readSyncChanges(input: {
  since: Date
  afterExternalId?: string
  limit?: number
}): Promise<SyncChangesPage> {
  const limit = Math.min(input.limit ?? CHANGES_PAGE_SIZE, CHANGES_PAGE_SIZE)

  // On demande un élément de plus que la page : sa présence indique qu'il
  // existe une suite, sans avoir à compter quoi que ce soit.
  const rows = await prisma.$queryRaw<ChangeRow[]>`
    SELECT
      a."externalId",
      a."sku",
      a."slug",
      a."status"::text AS "status",
      a."priceCents",
      a."publishedAt",
      a."soldAt",
      a."reservedUntil",
      a."updatedAt",
      (SELECT COUNT(*)::int FROM "ArticleImage" i WHERE i."articleId" = a."id")
        AS "imageCount",
      failed."lastError" AS "imagesError"
    FROM "Article" a
    -- Dernier travail d'images en échec pour cette pièce, s'il y en a un.
    -- La jointure est LATERALE et EXTERNE : une pièce sans échec doit figurer
    -- quand même, avec un motif nul.
    LEFT JOIN LATERAL (
      SELECT j."lastError"
      FROM "Job" j
      WHERE j."type" = 'article.images'
        AND j."payload"->>'articleId' = a."id"
        AND j."completedAt" IS NULL
        AND j."lastError" IS NOT NULL
      ORDER BY j."updatedAt" DESC
      LIMIT 1
    ) failed ON TRUE
    WHERE a."externalId" IS NOT NULL
      AND (
        a."updatedAt" > ${input.since}
        OR (
          a."updatedAt" = ${input.since}
          AND a."externalId" > ${input.afterExternalId ?? ''}
        )
      )
    ORDER BY a."updatedAt" ASC, a."externalId" ASC
    LIMIT ${limit + 1}
  `

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const changes = page.map((row) => ({
    externalId: row.externalId,
    sku: row.sku,
    slug: row.slug,
    status: row.status,
    priceCents: row.priceCents,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    soldAt: row.soldAt?.toISOString() ?? null,
    reservedUntil: row.reservedUntil?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    imagesPending: row.imageCount === 0,
    imagesError: row.imagesError,
  }))

  // Le curseur repart de la DERNIÈRE ligne rendue, jamais de « maintenant ».
  // Prendre l'heure courante ferait sauter tout ce qui a été modifié pendant
  // que la page se construisait — et cela ne se verrait jamais, puisque rien
  // ne signale ce qu'on n'a pas reçu.
  const last = page.at(-1)

  return {
    changes,
    nextSince: last?.updatedAt.toISOString() ?? input.since.toISOString(),
    nextAfter: last?.externalId ?? input.afterExternalId ?? null,
    hasMore,
  }
}
