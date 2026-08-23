import 'server-only'

import type { Prisma } from '@prisma/client'

/**
 * Numéro d'inventaire et adresse publique d'une pièce.
 *
 * Les deux sont attribués par la BOUTIQUE, jamais reçus de l'application de
 * gestion : le contrat le dit (`docs/synchronisation.md`, §2.5), et la raison
 * est qu'ils engagent la boutique seule. Une adresse publique référencée par
 * les moteurs de recherche ne peut pas dépendre d'un identifiant qu'un autre
 * système renumérote.
 */

/** Clé du compteur de numéros d'inventaire. */
const SKU_COUNTER_KEY = 'article-sku'

/** Largeur du numéro. Six chiffres couvrent un million de pièces. */
const SKU_DIGITS = 6

/**
 * Attribue le prochain numéro d'inventaire.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un compteur en ligne, et non une séquence PostgreSQL
 * ---------------------------------------------------------------------------
 * Ici, contrairement aux factures, un trou serait sans conséquence légale : un
 * numéro d'inventaire n'est pas une pièce comptable. Mais une séquence
 * consommerait un numéro à chaque tentative rejetée, et l'import initial en
 * rejette forcément quelques-unes. Une numérotation qui saute de 40 sur un lot
 * de 100 donne l'impression d'un stock perdu, et fait chercher longtemps.
 *
 * Le compteur est donc une LIGNE, incrémentée dans la transaction qui écrit la
 * pièce. Si cette transaction échoue, l'incrément échoue avec elle.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une amorce sur l'existant
 * ---------------------------------------------------------------------------
 * Cinquante pièces existent déjà, semées avec `ART-000001` à `ART-000050`, et
 * le compteur n'en sait rien. Repartir de 1 ferait échouer chaque insertion sur
 * l'unicité du numéro jusqu'à la cinquante et unième.
 *
 * On amorce donc le compteur, une fois, à partir du plus grand numéro
 * réellement présent. La lecture préalable est indexée et ne coûte rien ; sans
 * elle, la sous-requête d'amorçage serait évaluée à chaque appel, y compris les
 * dix millièmes.
 */
export async function allocateInventoryNumber(
  tx: Prisma.TransactionClient,
): Promise<{ sku: string; sequence: number }> {
  const existing = await tx.$queryRaw<{ value: number }[]>`
    SELECT "value" FROM "Counter" WHERE "key" = ${SKU_COUNTER_KEY}
  `

  if (existing.length === 0) {
    await tx.$executeRaw`
      INSERT INTO "Counter" ("key", "value", "updatedAt")
      SELECT ${SKU_COUNTER_KEY},
             COALESCE(
               MAX(NULLIF(regexp_replace("sku", '[^0-9]', '', 'g'), ''))::int,
               0
             ),
             now()
      FROM "Article"
      ON CONFLICT ("key") DO NOTHING
    `
  }

  const [row] = await tx.$queryRaw<[{ value: number }]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt")
    VALUES (${SKU_COUNTER_KEY}, 1, now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = "Counter"."value" + 1,
          "updatedAt" = now()
    RETURNING "value"
  `

  if (!row) {
    throw new Error('Compteur d’inventaire : aucune valeur renvoyée.')
  }

  // La valeur numérique est renvoyée telle quelle, et non relue depuis la
  // chaîne : l'adresse publique se termine par ce nombre, et la déduire du
  // format du numéro ferait changer toutes les adresses le jour où le numéro
  // gagnerait un chiffre.
  return { sku: formatSku(row.value), sequence: row.value }
}

export function formatSku(value: number): string {
  return `ART-${String(value).padStart(SKU_DIGITS, '0')}`
}

/**
 * Réduit un texte à ce qui peut figurer dans une URL.
 *
 * Les diacritiques sont décomposés puis retirés — « écru » devient « ecru » —
 * plutôt que remplacés par un tiret : « -cru » ne se lit pas, et ne se
 * recherche pas.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Longueur maximale d'un fragment de slug, avant le numéro. */
const SLUG_BODY_MAX = 60

/**
 * Compose l'adresse publique d'une pièce.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le numéro d'inventaire à la fin
 * ---------------------------------------------------------------------------
 * Deux chemises Ralph Lauren en L existent, et rien ne les distingue par leurs
 * attributs. Sans discriminant, la seconde échouerait sur l'unicité du slug —
 * en plein import, pour une raison qui n'a rien à voir avec les données
 * envoyées.
 *
 * Le suffixe n'est PAS un identifiant technique exposé par accident : c'est le
 * numéro d'inventaire, celui qui figure sur la fiche et sur la facture. Le
 * lire dans l'adresse aide plus qu'il ne gêne.
 *
 * ---------------------------------------------------------------------------
 * L'adresse ne change jamais ensuite
 * ---------------------------------------------------------------------------
 * Elle est calculée à la CRÉATION et n'est plus recalculée. Une pièce dont le
 * titre est corrigé garde son adresse : un lien partagé, un signet, une page
 * indexée continuent de fonctionner. Le référencement acquis vaut mieux qu'un
 * slug parfaitement à jour.
 */
export function buildArticleSlug(input: {
  categorySlug: string
  brandSlug: string | null
  sizeLabel: string
  sequence: number
}): string {
  const body = [
    input.categorySlug,
    input.brandSlug,
    slugify(input.sizeLabel),
  ]
    .filter((part): part is string => Boolean(part))
    .join('-')
    .slice(0, SLUG_BODY_MAX)
    .replace(/-+$/, '')

  return `${body}-${input.sequence}`
}
