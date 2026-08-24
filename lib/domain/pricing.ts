/**
 * Calculs de prix — fonctions pures, sans base de données ni requête HTTP.
 *
 * Tous les montants sont des entiers en centimes. Aucun Float n'entre dans un
 * calcul de prix : les erreurs d'arrondi binaire n'ont rien à faire dans une
 * comptabilité.
 */

export interface PricingConfig {
  /**
   * Cotisations sociales et fiscales, en points de base du chiffre d'affaires
   * (1230 = 12,30 %). Micro-entreprise, vente de marchandises.
   */
  contributionRateBps: number
  /** Commission Stripe variable, en points de base (150 = 1,50 %). */
  stripePercentBps: number
  /** Part fixe de la commission Stripe, en centimes. */
  stripeFixedCents: number
  /** Marge nette minimale visée sur une vente, en centimes. */
  minMarginCents: number
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  // Ces valeurs sont des paramètres, pas des vérités : elles vivent dans la
  // table Setting et se règlent en back-office sans redéploiement.
  contributionRateBps: 1230,
  stripePercentBps: 150,
  stripeFixedCents: 25,
  minMarginCents: 300,
}

const BPS = 10_000

/** Arrondi vers le haut à la dizaine de centimes. */
export function roundUpToTenCents(cents: number): number {
  return Math.ceil(cents / 10) * 10
}

/**
 * Commission Stripe pour un encaissement donné.
 * Arrondie au centime supérieur : c'est ce que Stripe prélève réellement.
 */
export function stripeFeeCents(
  grossCents: number,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): number {
  return (
    Math.ceil((grossCents * config.stripePercentBps) / BPS) +
    config.stripeFixedCents
  )
}

/** Cotisations dues sur un encaissement donné. */
export function contributionCents(
  grossCents: number,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): number {
  return Math.ceil((grossCents * config.contributionRateBps) / BPS)
}

export interface FloorPriceInput {
  /** Prix d'achat de la pièce, en centimes. */
  costCents: number
  /** Coût transporteur estimé, en centimes. */
  estimatedShippingCostCents: number
}

/**
 * Plancher de négociation.
 *
 * Résout l'inéquation, où P est le prix encaissé :
 *
 *   P − cotisations(P) − commissionStripe(P) − coût − port ≥ margeMinimale
 *
 * Les deux prélèvements étant proportionnels à P, on isole :
 *
 *   P ≥ (margeMinimale + coût + port + partFixeStripe) / (1 − tauxCotisations − tauxStripe)
 *
 * Le port entre volontairement dans le plancher : au-dessus du seuil de
 * livraison offerte, c'est le vendeur qui le supporte, et une offre acceptée
 * ne doit pas devenir déficitaire dans ce cas.
 */
export function computeFloorPriceCents(
  input: FloorPriceInput,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): number {
  const variableRateBps =
    config.contributionRateBps + config.stripePercentBps

  if (variableRateBps >= BPS) {
    throw new Error(
      'Configuration de prix incohérente : les prélèvements proportionnels atteignent ou dépassent 100 %.',
    )
  }

  const numerator =
    config.minMarginCents +
    input.costCents +
    input.estimatedShippingCostCents +
    config.stripeFixedCents

  // La forme close suppose des prélèvements exactement proportionnels. En
  // pratique, cotisations et commission Stripe sont chacune arrondies au
  // centime supérieur, et ces deux arrondis se cumulent : le résultat peut
  // manquer la marge visée d'un ou deux centimes.
  //
  // On s'en sert donc comme point de départ, puis on remonte par paliers de
  // 10 centimes jusqu'à ce que la marge RÉELLEMENT calculée atteigne la
  // cible. Le plancher est une garantie dure : il doit tenir à l'exécution,
  // pas seulement en algèbre.
  let candidate = roundUpToTenCents(
    Math.ceil((numerator * BPS) / (BPS - variableRateBps)),
  )

  // Chaque palier de 10 centimes ajoute environ 8,6 centimes de marge nette :
  // la boucle converge en une ou deux itérations. La borne est un garde-fou
  // contre une configuration aberrante, pas un cas nominal.
  for (let step = 0; step < 100; step += 1) {
    const margin = computeNetMarginCents(
      {
        salePriceCents: candidate,
        costCents: input.costCents,
        shippingCostCents: input.estimatedShippingCostCents,
      },
      config,
    )

    if (margin >= config.minMarginCents) return candidate
    candidate += 10
  }

  throw new Error(
    'Impossible d’atteindre la marge minimale : vérifier la configuration de prix.',
  )
}

/**
 * Marge nette réellement dégagée par une vente.
 *
 * Sert à l'alerte bloquante du back-office quand une offre passe sous le
 * plancher : on affiche le montant perdu, pas un simple avertissement.
 */
export function computeNetMarginCents(
  {
    salePriceCents,
    shippingChargedCents = 0,
    costCents,
    shippingCostCents,
  }: {
    salePriceCents: number
    shippingChargedCents?: number
    costCents: number
    shippingCostCents: number
  },
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): number {
  // Le port facturé entre dans le chiffre d'affaires : il supporte donc lui
  // aussi les cotisations et la commission.
  const gross = salePriceCents + shippingChargedCents

  return (
    gross -
    contributionCents(gross, config) -
    stripeFeeCents(gross, config) -
    costCents -
    shippingCostCents
  )
}

// Le prix de port facturé vit dans `lib/domain/shipping.ts`, et nulle part
// ailleurs.
//
// Une seconde version existait ici, et elle calculait en flottant : ce fichier
// annonce pourtant en tête qu'« aucun Float n'entre dans un calcul de prix ».
// Les deux divergeaient réellement — 1,00 € de coût transporteur majoré de
// 10 % donnait 1,20 € ici contre 1,10 € là-bas, parce que 1 × 1.1 vaut
// 1.1000000000000001 en virgule flottante.
//
// Aucune conséquence tant qu'elle n'avait pas d'appelant et que la majoration
// réglée valait 20 %, l'une des valeurs où les deux coïncident. C'était un
// piège dormant, qui se serait réveillé le jour d'un réglage à 10 % depuis le
// back-office.

/**
 * Un palier du barème de baisse automatique.
 *
 * Le pourcentage s'applique au prix d'ORIGINE, jamais au prix déjà baissé :
 * un barème « 30 j → −10 %, 60 j → −20 % » promet −20 % au bout de deux mois,
 * pas −10 % puis −10 % du reste (−28 %). Composer les remises ferait dire au
 * barème autre chose que ce que le back-office a réglé.
 */
export interface AutoDropStage {
  /** Ancienneté, en jours depuis la publication, à partir de laquelle il vaut. */
  days: number
  /** Remise sur le prix d'origine, en pourcentage entier. */
  percent: number
}

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Le palier dû pour une pièce, à un instant donné.
 *
 * C'est le palier atteint LE PLUS ANCIEN qui vaut, pas le premier : une pièce
 * de soixante-dix jours dont aucune baisse n'a jamais été appliquée — le cron
 * était en panne, le barème vient d'être activé — va directement à −20 %.
 * La faire passer par −10 % ne rattraperait le retard qu'au balayage suivant,
 * et il n'y a rien à rattraper : le barème dit où le prix DOIT être.
 *
 * Un seul parcours, sans tri : l'ordre du tableau — un JSON édité en
 * back-office — est indifférent, et la fonction est appelée pour chaque pièce
 * candidate à chaque balayage.
 */
export function dueDropStage(
  schedule: readonly AutoDropStage[],
  publishedAt: Date,
  now: Date,
): AutoDropStage | null {
  let due: AutoDropStage | null = null

  for (const stage of schedule) {
    if (publishedAt.getTime() + stage.days * DAY_MS > now.getTime()) continue
    if (due === null || stage.days > due.days) due = stage
  }

  return due
}

/**
 * Baisse de prix automatique.
 *
 * Le prix descend parce que le vendeur l'a décidé au bout d'un certain temps,
 * jamais parce qu'on l'a négocié — et jamais sous le plancher.
 */
export function computeAutoDropPriceCents({
  basePriceCents,
  floorPriceCents,
  percent,
}: {
  basePriceCents: number
  floorPriceCents: number
  percent: number
}): number {
  const dropped = roundUpToTenCents(
    Math.floor((basePriceCents * (100 - percent)) / 100),
  )
  return Math.max(dropped, floorPriceCents)
}
