import { z } from 'zod'

import {
  ARTICLE_COLORS,
  ARTICLE_CONDITIONS,
  ARTICLE_FITS,
  ARTICLE_MATERIALS,
  MEASUREMENT_KEYS,
  MEASUREMENT_MAX_CM,
  MEASUREMENT_MIN_CM,
} from '@/lib/domain/vocabulary'

/**
 * Validation du contrat d'inventaire — `POST /api/sync/articles`.
 *
 * Le contrat complet est dans `docs/synchronisation.md`. Ce fichier en est la
 * traduction exécutable : ce qui n'est pas écrit ici n'est pas accepté, même
 * si le document le mentionne.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un motif de refus par champ
 * ---------------------------------------------------------------------------
 * De l'autre côté, personne ne lit ce code. Une réponse « 400 invalide » sur
 * un lot de cent pièces oblige à deviner laquelle et pourquoi. Chaque entrée
 * refusée porte donc un motif STABLE — une chaîne, pas une phrase — et un
 * détail lisible qui, lui, peut changer.
 *
 * Les motifs viennent du contrat. Trois s'y ajoutent, et le document le dit :
 * `already-sold`, `invalid-field` et `article-not-a-batch`. Écraser un cas réel
 * dans un motif approchant serait pire que d'en déclarer un de plus.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `.strict()`
 * ---------------------------------------------------------------------------
 * Une clé inconnue est refusée, elle n'est pas ignorée. Le cas qui décide :
 * `colour` au lieu de `color`. Un schéma permissif laisserait passer la pièce
 * SANS sa couleur, publiée, invisible dans la facette « couleur », et personne
 * ne l'apprendrait jamais. Le contrat énumère les champs autorisés ; les
 * refuser tous les autres est ce qui rend cette énumération vraie.
 *
 * Corollaire assumé : le jour où l'application enverra un champ nouveau, la
 * boutique refusera jusqu'à ce que les deux côtés soient d'accord. C'est le
 * comportement voulu d'un contrat.
 */

// ---------------------------------------------------------------------------
// Motifs de refus
// ---------------------------------------------------------------------------

export const SYNC_REJECTION_REASONS = [
  'unknown-category',
  'unknown-color',
  'unknown-material',
  'unknown-fit',
  'weight-not-covered',
  'invalid-price',
  'compare-price-not-higher',
  'payload-too-large',
  'locked-by-checkout',
  // Ajouts déclarés — voir l'en-tête.
  'already-sold',
  'invalid-field',
  'article-not-a-batch',
] as const

export type SyncRejectionReason = (typeof SYNC_REJECTION_REASONS)[number]

// ---------------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------------

/** Au-delà, un lot ne tient plus dans le temps imparti à une fonction. */
export const MAX_BATCH_SIZE = 100

/** Nombre d'images par pièce, tel que le contrat l'annonce. */
export const MIN_IMAGES = 1
export const MAX_IMAGES = 10

/**
 * Borne de sécurité sur les montants — PAS une règle commerciale.
 *
 * Les colonnes de prix sont des `Int` PostgreSQL, donc 32 bits signés. Une
 * valeur au-delà lève à l'insertion, après avoir fait tourner le calcul du
 * plancher pour rien. On borne bien en dessous : cent mille euros la pièce
 * n'est pas un prix de friperie, c'est une confusion d'unité.
 */
const MAX_AMOUNT_CENTS = 100_000_00

/**
 * Borne de sécurité sur le poids — PAS le palier transporteur.
 *
 * Le vrai refus (`weight-not-covered`) se décide en base, contre le palier le
 * plus lourd RÉELLEMENT tarifé, emballage compris. Ici on écarte seulement
 * l'absurde, pour ne pas faire d'aller-retour en base sur une valeur qui n'a
 * aucune chance : cinquante kilos, ce n'est pas un vêtement.
 */
const MAX_WEIGHT_GRAMS = 50_000

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------

const amountCents = z
  .number()
  .int('doit être un entier de centimes, jamais un montant décimal')
  .max(MAX_AMOUNT_CENTS)

/**
 * URL d'image.
 *
 * `https` seulement : une image récupérée en clair peut être remplacée en
 * route, et la fiche afficherait ce que l'intercepteur a choisi.
 *
 * L'adresse littérale est refusée ici parce qu'elle ne peut avoir qu'une
 * raison d'être — viser une machine du réseau interne. Ce n'est PAS la
 * protection principale : la résolution DNS est vérifiée au téléchargement,
 * dans `lib/sync/images.ts`, parce qu'un nom de domaine public peut pointer
 * vers 169.254.169.254 tout aussi bien.
 */
const imageUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return false
    }

    if (parsed.protocol !== 'https:') return false

    // Un nom d'hôte qui n'est fait que de chiffres et de points est une IPv4 ;
    // les crochets encadrent une IPv6.
    const host = parsed.hostname
    if (/^\d+(\.\d+)*$/.test(host)) return false
    if (host.startsWith('[')) return false

    return true
  }, 'doit être une URL https absolue, sur un nom de domaine')

// `partialRecord` et non `record` : avec un enum en clé, Zod 4 exige TOUTES
// les clés. Un pantalon n'a pas d'épaules, et une chaussure n'a ni taille ni
// hanches — exiger les huit rendrait le champ inutilisable.
const measurements = z
  .partialRecord(z.enum(MEASUREMENT_KEYS), z.number().finite())
  .refine(
    (value) =>
      Object.values(value).every(
        (cm) => cm >= MEASUREMENT_MIN_CM && cm <= MEASUREMENT_MAX_CM,
      ),
    `chaque mesure est en centimètres, entre ${MEASUREMENT_MIN_CM} et ${MEASUREMENT_MAX_CM}`,
  )

// ---------------------------------------------------------------------------
// L'article
// ---------------------------------------------------------------------------

export const syncArticleSchema = z
  .object({
    externalId: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(200),
    categorySlug: z.string().trim().min(1).max(64),
    condition: z.enum(ARTICLE_CONDITIONS),
    sizeLabel: z.string().trim().min(1).max(32),
    priceCents: amountCents.positive(),
    costCents: amountCents.nonnegative(),
    weightGrams: z.number().int().positive().max(MAX_WEIGHT_GRAMS),
    images: z.array(imageUrl).min(MIN_IMAGES).max(MAX_IMAGES),

    description: z.string().trim().min(1).max(5000).optional(),
    brandName: z.string().trim().min(1).max(80).optional(),
    comparePriceCents: amountCents.positive().optional(),
    color: z.enum(ARTICLE_COLORS).optional(),
    material: z.enum(ARTICLE_MATERIALS).optional(),
    fit: z.enum(ARTICLE_FITS).optional(),
    measurements: measurements.optional(),

    /**
     * Seuls ces deux états s'envoient. `SOLD` et `RESERVED` dépendent d'un
     * paiement encaissé ou d'un verrou de caisse, jamais d'une déclaration :
     * les accepter laisserait l'application marquer vendue une pièce que
     * personne n'a payée, et disparaître un article d'un panier ouvert.
     */
    status: z.enum(['AVAILABLE', 'ARCHIVED']).optional(),
  })
  .strict()
  /**
   * Le prix barré doit être STRICTEMENT supérieur au prix demandé.
   *
   * Ce n'est pas une coquetterie de validation : l'article L112-1-1 du code de
   * la consommation impose que le prix de référence annoncé ait réellement été
   * pratiqué. Un prix barré égal ou inférieur affiche une remise qui n'existe
   * pas — pratique commerciale trompeuse, et sanctionnée comme telle.
   */
  .refine(
    (article) =>
      article.comparePriceCents === undefined ||
      article.comparePriceCents > article.priceCents,
    {
      path: ['comparePriceCents'],
      message:
        'doit être strictement supérieur à priceCents — un prix de référence qui ne l’est pas annonce une remise inexistante',
    },
  )

export type SyncArticleInput = z.infer<typeof syncArticleSchema>

// ---------------------------------------------------------------------------
// De l'erreur Zod au motif du contrat
// ---------------------------------------------------------------------------

/**
 * Traduit la PREMIÈRE anomalie en motif de refus.
 *
 * Une seule, délibérément : la réponse dit pourquoi la pièce est refusée, elle
 * ne relit pas la saisie. Corriger la première anomalie et renvoyer révèle la
 * suivante, et le lot converge.
 */
export function reasonForIssue(issue: z.core.$ZodIssue): SyncRejectionReason {
  const field = issue.path[0]

  switch (field) {
    case 'categorySlug':
      return 'unknown-category'
    case 'color':
      return 'unknown-color'
    case 'material':
      return 'unknown-material'
    case 'fit':
      return 'unknown-fit'
    case 'weightGrams':
      return 'weight-not-covered'
    case 'priceCents':
    case 'costCents':
      return 'invalid-price'
    case 'comparePriceCents':
      return 'compare-price-not-higher'
    default:
      return 'invalid-field'
  }
}

/** Détail lisible : quel champ, et ce qu'on en attendait. */
export function detailForIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.join('.')
  return path ? `${path} : ${issue.message}` : issue.message
}
