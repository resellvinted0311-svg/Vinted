/**
 * Zones et grille tarifaire.
 *
 * Règle absolue : le prix du port dépend du POIDS et de la ZONE, jamais d'une
 * distance ni de coordonnées géographiques.
 *
 * `priceCents` est le TARIF TRANSPORTEUR (le coût). Le prix facturé à
 * l'acheteur en est dérivé par Setting.shippingMarkupPercent — voir
 * computeChargedShippingCents(). Ne jamais confondre les deux.
 */

export interface ZoneSeed {
  code: string
  name: string
  countries: string[]
  postalPrefixes?: string[]
  freeShippingThresholdCents: number | null
  position: number
  requiresCustoms?: boolean
}

export const ZONES: ZoneSeed[] = [
  {
    code: 'FR',
    name: 'France métropolitaine',
    countries: ['FR'],
    freeShippingThresholdCents: 4000,
    position: 1,
  },
  {
    // La Corse est discriminée par préfixe postal, prioritaire sur le pays.
    code: 'FR_CORSE',
    name: 'Corse',
    countries: ['FR'],
    postalPrefixes: ['20'],
    freeShippingThresholdCents: null,
    position: 2,
  },
  {
    code: 'FR_DOM',
    name: 'Outre-mer',
    countries: ['FR'],
    // 971 à 978 : Guadeloupe, Martinique, Guyane, La Réunion, Saint-Pierre-et-
    // Miquelon, Mayotte, Saint-Barthélemy, Saint-Martin.
    //
    // 984, 986, 987, 988 ajoutés après relecture : les Terres australes,
    // Wallis-et-Futuna, la Polynésie française et la Nouvelle-Calédonie portent
    // elles aussi le code pays FR. Absentes de cette liste, elles retombaient
    // sur la zone générique — donc Nouméa facturée au tarif de Paris, à un
    // tiers du coût réel, sans qu'aucune erreur ne le signale.
    postalPrefixes: [
      '971', '972', '973', '974', '975', '976', '977', '978',
      '984', '986', '987', '988',
    ],
    freeShippingThresholdCents: null,
    position: 3,
    requiresCustoms: true,
  },
  {
    code: 'EU1',
    name: 'Union européenne — zone 1',
    countries: ['BE', 'LU', 'NL', 'DE', 'ES', 'IT', 'PT', 'AT'],
    freeShippingThresholdCents: 8000,
    position: 4,
  },
  {
    code: 'EU2',
    name: 'Union européenne — zone 2',
    countries: [
      'IE', 'DK', 'SE', 'FI', 'PL', 'CZ', 'SK', 'HU',
      'RO', 'BG', 'GR', 'HR', 'SI', 'EE', 'LV', 'LT', 'MT', 'CY',
    ],
    // Jamais de port offert : les tarifs y sont trop élevés pour un panier
    // moyen de 10 à 20 €.
    freeShippingThresholdCents: null,
    position: 5,
  },
  {
    code: 'EUROPE_NON_EU',
    name: 'Europe hors UE',
    countries: ['CH', 'GB', 'NO'],
    freeShippingThresholdCents: null,
    position: 6,
    // Déclaration douanière CN22 / CN23 obligatoire.
    requiresCustoms: true,
  },
]

export interface RateSeed {
  zoneCode: string
  carrierCode: string
  serviceCode: string
  label: string
  maxWeightGrams: number
  /** Coût transporteur, hors majoration. */
  priceCents: number
  deliveryDaysMin: number
  deliveryDaysMax: number
  requiresServicePoint?: boolean
}

/** Paliers de poids communs à toutes les zones. */
const TIERS = [500, 1000, 2000, 5000] as const

function tiered(
  zoneCode: string,
  carrierCode: string,
  serviceCode: string,
  label: string,
  prices: readonly [number, number, number, number],
  deliveryDaysMin: number,
  deliveryDaysMax: number,
  requiresServicePoint = false,
): RateSeed[] {
  return TIERS.map((maxWeightGrams, index) => ({
    zoneCode,
    carrierCode,
    serviceCode,
    label,
    maxWeightGrams,
    priceCents: prices[index] as number,
    deliveryDaysMin,
    deliveryDaysMax,
    requiresServicePoint,
  }))
}

export const RATES: RateSeed[] = [
  // ---- France métropolitaine ---------------------------------------------
  ...tiered('FR', 'mondial_relay', 'MR_RELAY', 'Point relais', [420, 480, 590, 890], 2, 4, true),
  ...tiered('FR', 'colissimo', 'COL_HOME', 'À domicile', [560, 680, 820, 1320], 2, 3),

  // ---- Corse --------------------------------------------------------------
  ...tiered('FR_CORSE', 'colissimo', 'COL_HOME', 'À domicile', [720, 880, 1090, 1690], 3, 6),

  // ---- DOM-TOM ------------------------------------------------------------
  ...tiered('FR_DOM', 'colissimo', 'COL_HOME', 'À domicile', [1450, 1890, 2590, 4200], 5, 10),

  // ---- UE zone 1 ----------------------------------------------------------
  ...tiered('EU1', 'mondial_relay', 'MR_RELAY', 'Point relais', [650, 760, 950, 1450], 3, 6, true),
  ...tiered('EU1', 'colissimo', 'COL_HOME', 'À domicile', [980, 1180, 1450, 2200], 3, 5),

  // ---- UE zone 2 ----------------------------------------------------------
  ...tiered('EU2', 'colissimo', 'COL_HOME', 'À domicile', [1290, 1550, 1950, 2950], 4, 8),

  // ---- Europe hors UE -----------------------------------------------------
  ...tiered('EUROPE_NON_EU', 'colissimo', 'COL_HOME', 'À domicile', [1590, 1920, 2450, 3800], 5, 10),
]

/**
 * Coût transporteur le moins cher pour un poids donné en France.
 * Sert au calcul du plancher de prix à la création d'un article.
 */
export function cheapestFrenchCarrierCostCents(weightGrams: number): number {
  const candidates = RATES.filter(
    (rate) => rate.zoneCode === 'FR' && rate.maxWeightGrams >= weightGrams,
  ).map((rate) => rate.priceCents)

  if (candidates.length === 0) {
    // Au-delà du palier le plus lourd : on retient le tarif le plus élevé
    // plutôt que d'inventer une extrapolation.
    return Math.max(...RATES.filter((r) => r.zoneCode === 'FR').map((r) => r.priceCents))
  }

  return Math.min(...candidates)
}
