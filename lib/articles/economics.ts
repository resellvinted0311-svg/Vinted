import 'server-only'

import { computeFloorPriceCents, type PricingConfig } from '@/lib/domain/pricing'

/**
 * L'économie d'une pièce : coût transporteur estimé, puis prix plancher.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce calcul est extrait ici
 * ---------------------------------------------------------------------------
 * Il vivait à l'intérieur de `syncArticle`, en partie dans une fonction privée.
 * Tant que l'API de synchronisation était le seul chemin d'écriture, cela ne
 * portait pas à conséquence.
 *
 * Depuis qu'un écran d'administration écrit lui aussi des pièces, deux copies
 * du même calcul finiraient par diverger — et la divergence ne se verrait
 * nulle part : une pièce importée et une pièce saisie à la main auraient deux
 * planchers différents pour un même coût d'achat et un même poids. Le prix
 * plancher est la seule chose qui empêche une négociation de vendre à perte.
 *
 * ---------------------------------------------------------------------------
 * Le poids qui compte est celui du COLIS
 * ---------------------------------------------------------------------------
 * Le transporteur facture ce qu'il transporte : la pièce ET son emballage. Un
 * calcul mené sur le poids de la pièce nue choisit un palier trop bas, et le
 * refus tombe à la caisse, devant l'acheteuse, sur une pièce qu'on croyait
 * vendable.
 */

export interface ArticleEconomicsContext {
  /** Poids de l'emballage, en grammes. Vient de `Setting`. */
  packagingWeightGrams: number
  /**
   * Les paliers de la zone de RÉFÉRENCE, pas de toutes les zones.
   *
   * Le plancher intègre le port parce qu'au-dessus du seuil de livraison
   * offerte c'est le vendeur qui le supporte. Encore faut-il savoir quel port :
   * la même pièce ne coûte pas le même prix à expédier en France et en
   * outre-mer. La zone de référence est un réglage — celle où la boutique vend
   * réellement le plus.
   */
  rates: readonly { maxWeightGrams: number; priceCents: number }[]
  pricing: PricingConfig
}

export type ArticleEconomics =
  | {
      ok: true
      parcelWeightGrams: number
      /** Coût transporteur du palier retenu, en centimes. */
      carrierCostCents: number
      floorPriceCents: number
    }
  | { ok: false; reason: 'no-covering-rate' }

/**
 * Le tarif le moins cher qui COUVRE le poids du colis.
 *
 * Aucune extrapolation au-delà du dernier palier : inventer un tarif, c'est
 * facturer un port que personne n'a négocié — et le payer soi-même.
 */
export function cheapestCoveringRate(
  rates: readonly { maxWeightGrams: number; priceCents: number }[],
  parcelWeightGrams: number,
): number | null {
  const covering = rates
    .filter((rate) => rate.maxWeightGrams >= parcelWeightGrams)
    .map((rate) => rate.priceCents)

  return covering.length === 0 ? null : Math.min(...covering)
}

/**
 * Le plancher d'une pièce, à partir de son poids et de son coût d'achat.
 *
 * Les deux entrent : le poids décide du palier transporteur, le coût d'achat
 * est la somme à récupérer avant de gagner quoi que ce soit. Corriger l'un sans
 * recalculer l'autre laisserait un plancher qui ne protège plus de rien — c'est
 * pourquoi ce calcul est refait à CHAQUE écriture, jamais lu depuis le client.
 */
export function computeArticleEconomics(
  input: { weightGrams: number; costCents: number },
  context: ArticleEconomicsContext,
): ArticleEconomics {
  const parcelWeightGrams = input.weightGrams + context.packagingWeightGrams

  const carrierCostCents = cheapestCoveringRate(context.rates, parcelWeightGrams)
  if (carrierCostCents === null) return { ok: false, reason: 'no-covering-rate' }

  return {
    ok: true,
    parcelWeightGrams,
    carrierCostCents,
    floorPriceCents: computeFloorPriceCents(
      {
        costCents: input.costCents,
        estimatedShippingCostCents: carrierCostCents,
      },
      context.pricing,
    ),
  }
}
