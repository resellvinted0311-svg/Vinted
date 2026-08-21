/**
 * Calcul du port — fonctions pures, sans base ni réseau.
 *
 * Règle absolue, héritée du brief : le prix dépend du POIDS et de la ZONE,
 * jamais d'une distance ni de coordonnées géographiques.
 *
 * ---------------------------------------------------------------------------
 * Deux prix, à ne jamais confondre
 * ---------------------------------------------------------------------------
 * `carrierCostCents` est ce que COÛTE l'expédition (tarif transporteur).
 * `chargedCents` est ce que PAIE l'acheteur. Le second dérive du premier par
 * la majoration, jamais l'inverse, et le coût transporteur ne doit jamais être
 * écrit tel quel dans un montant facturé.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la configuration est un paramètre obligatoire
 * ---------------------------------------------------------------------------
 * `lib/domain/pricing.ts` accepte une configuration par défaut. C'est pratique,
 * mais cela rend les valeurs de la table `Setting` décoratives : un appelant qui
 * oublie de les lire obtient quand même un résultat, silencieusement faux.
 *
 * Ici il n'y a AUCUNE valeur par défaut. Oublier de lire les réglages ne
 * compile pas. C'est la seule protection mécanique contre « ne code aucun
 * coefficient en dur ».
 */

import { roundUpToTenCents } from './pricing'

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

/** Réglages lus depuis la table `Setting`. Aucun défaut, volontairement. */
export interface ShippingConfig {
  /** Poids de l'emballage, ajouté une fois par colis. */
  packagingWeightGrams: number
  /** Majoration appliquée au coût transporteur pour obtenir le prix payé. */
  shippingMarkupPercent: number
}

/** Zone telle que stockée, débarrassée de ses colonnes techniques. */
export interface ShippingZoneGrid {
  code: string
  name: string
  /** Codes ISO 3166-1 alpha-2. */
  countries: string[]
  /**
   * Préfixes de code postal qui rattachent une adresse à cette zone EN
   * PRIORITÉ sur le pays. Corse : 20. Outre-mer : 971 à 988.
   */
  postalPrefixes: string[]
  freeShippingThresholdCents: number | null
  requiresCustoms: boolean
  position: number
}

/** Tarif tel que stocké. `priceCents` est un COÛT, jamais un prix payé. */
export interface ShippingRateGrid {
  zoneCode: string
  carrierCode: string
  serviceCode: string
  label: string
  maxWeightGrams: number
  priceCents: number
  deliveryDaysMin: number
  deliveryDaysMax: number
  requiresServicePoint: boolean
}

export interface ShippingDestination {
  /** ISO 3166-1 alpha-2, insensible à la casse. */
  countryCode: string
  /** Absent pour les pays qui n'en utilisent pas. */
  postalCode: string | null
}

// ---------------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------------

/**
 * Motifs d'échec.
 *
 * Un échec est TOUJOURS explicite : aucun repli sur une zone voisine, aucune
 * extrapolation de tarif, aucun prix inventé. Une adresse qu'on ne sait pas
 * desservir doit le dire, pas être facturée au hasard.
 */
export type ShippingFailure =
  | { reason: 'ZONE_UNKNOWN'; countryCode: string }
  | { reason: 'POSTAL_CODE_REQUIRED'; countryCode: string }
  | { reason: 'NO_RATE_FOR_ZONE'; zoneCode: string }
  | {
      reason: 'WEIGHT_NOT_COVERED'
      zoneCode: string
      weightGrams: number
      maxCoveredGrams: number
    }

export interface ShippingOption {
  carrierCode: string
  serviceCode: string
  label: string
  /** Coût transporteur. Ne jamais présenter à l'acheteur. */
  carrierCostCents: number
  /** Prix hors franchise, majoration comprise. Sert au prix barré. */
  fullChargedCents: number
  /** Prix réellement dû, franchise appliquée. */
  chargedCents: number
  freeShippingApplied: boolean
  deliveryDaysMin: number
  deliveryDaysMax: number
  requiresServicePoint: boolean
}

export interface ShippingQuote {
  zone: {
    code: string
    name: string
    requiresCustoms: boolean
    freeShippingThresholdCents: number | null
  }
  parcelWeightGrams: number
  options: ShippingOption[]
  /**
   * Prix dû pour l'option la MOINS CHÈRE, franchise appliquée.
   *
   * C'est le plafond du remboursement de port en cas de rétractation : l'article
   * L221-24 du code de la consommation impose de rembourser les frais de
   * livraison, dans la limite du mode standard le moins onéreux proposé. Sans
   * cette valeur figée au moment de la commande, ce remboursement devient
   * incalculable — une grille tarifaire change, et on ne sait plus ce qui était
   * proposé ce jour-là.
   */
  standardChargedCents: number
}

export type ShippingResult =
  | { ok: true; quote: ShippingQuote }
  | { ok: false; failure: ShippingFailure }

// ---------------------------------------------------------------------------
// Poids
// ---------------------------------------------------------------------------

/**
 * Poids réel du colis : la somme des articles, plus l'emballage UNE fois.
 *
 * L'emballage est compté par colis et non par article — c'est un carton, pas
 * une pochette par vêtement. Le compter par article gonflerait le poids d'un
 * panier de cinq pièces de quatre emballages fantômes, donc parfois d'un palier
 * tarifaire entier.
 */
export function computeParcelWeightGrams(
  articleWeightsGrams: readonly number[],
  config: ShippingConfig,
): number {
  const articles = articleWeightsGrams.reduce((sum, grams) => sum + grams, 0)
  return articles + config.packagingWeightGrams
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

/** Vrai si l'un des préfixes ouvre le code postal fourni. */
function matchesPrefix(postalCode: string, prefixes: readonly string[]): boolean {
  const normalized = postalCode.replace(/\s/g, '').toUpperCase()
  return prefixes.some((prefix) => normalized.startsWith(prefix))
}

/**
 * Résout la zone d'une destination.
 *
 * L'ordre compte : un préfixe postal l'emporte TOUJOURS sur le pays. Sans cela,
 * la Corse et l'outre-mer, qui portent le code pays FR, seraient facturés au
 * tarif de la métropole — pour l'outre-mer, trois fois moins que le coût réel.
 *
 * Quand un pays possède au moins une zone discriminée par code postal, l'absence
 * de code postal est un ÉCHEC et non un repli sur la zone générique : décider
 * que Nouméa est en métropole parce que l'adresse est incomplète, c'est vendre
 * à perte en silence.
 */
export function resolveShippingZone(
  destination: ShippingDestination,
  zones: readonly ShippingZoneGrid[],
): { ok: true; zone: ShippingZoneGrid } | { ok: false; failure: ShippingFailure } {
  const country = destination.countryCode.trim().toUpperCase()

  const inCountry = zones
    .filter((zone) => zone.countries.includes(country))
    .sort((a, b) => a.position - b.position)

  if (inCountry.length === 0) {
    return { ok: false, failure: { reason: 'ZONE_UNKNOWN', countryCode: country } }
  }

  const discriminated = inCountry.filter((zone) => zone.postalPrefixes.length > 0)

  if (discriminated.length > 0) {
    const postalCode = destination.postalCode?.trim() ?? ''
    if (postalCode === '') {
      return {
        ok: false,
        failure: { reason: 'POSTAL_CODE_REQUIRED', countryCode: country },
      }
    }

    // Le préfixe le plus LONG l'emporte : « 20 » (Corse) ne doit pas rafler un
    // code postal que « 201 » couvrirait plus précisément si la grille venait à
    // se raffiner.
    const byPrecision = [...discriminated].sort(
      (a, b) =>
        Math.max(...b.postalPrefixes.map((p) => p.length)) -
        Math.max(...a.postalPrefixes.map((p) => p.length)),
    )

    for (const zone of byPrecision) {
      if (matchesPrefix(postalCode, zone.postalPrefixes)) {
        return { ok: true, zone }
      }
    }
  }

  // Zone générique du pays : celle qui ne discrimine par aucun préfixe.
  const generic = inCountry.find((zone) => zone.postalPrefixes.length === 0)
  if (!generic) {
    return { ok: false, failure: { reason: 'ZONE_UNKNOWN', countryCode: country } }
  }

  return { ok: true, zone: generic }
}

// ---------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------

/**
 * Prix payé par l'acheteur pour un coût transporteur donné.
 *
 * Arrondi vers le haut à la dizaine de centimes, comme les prix d'articles :
 * un port à 5,04 € est une facture qui a l'air d'un bogue.
 */
export function computeChargedShippingCents(
  carrierCostCents: number,
  config: ShippingConfig,
): number {
  // Garde reprise de la version supprimée dans `pricing.ts` : une majoration
  // négative n'est pas une remise sur le port, c'est un réglage saisi de
  // travers. Mieux vaut s'arrêter que facturer moins que le transporteur.
  if (config.shippingMarkupPercent < 0) {
    throw new Error('La majoration sur le port ne peut pas être négative.')
  }

  // Entiers d'un bout à l'autre : `× (1 + m/100)` en flottant donnait
  // 1.1000000000000001 pour 1,00 € majoré de 10 %, donc 1,20 € au lieu de
  // 1,10 € après arrondi.
  const withMarkup = Math.ceil(
    (carrierCostCents * (100 + config.shippingMarkupPercent)) / 100,
  )
  return roundUpToTenCents(withMarkup)
}

/** Poids maximal couvert par la grille d'une zone. */
function maxCoveredGrams(rates: readonly ShippingRateGrid[]): number {
  return rates.reduce((max, rate) => Math.max(max, rate.maxWeightGrams), 0)
}

/**
 * Devis complet pour un panier.
 *
 * L'ordre des opérations est FIGÉ : coût transporteur → majoration → arrondi →
 * franchise. L'inverser ferait porter la majoration sur un port déjà offert,
 * c'est-à-dire majorer zéro, et surtout produirait un prix barré incohérent
 * avec le prix réellement pratiqué hors franchise.
 *
 * La franchise couvre le prix de l'option la MOINS CHÈRE de la zone. Une
 * personne qui préfère la livraison à domicile alors que le point relais est
 * offert paie la différence — offrir l'option la plus chère reviendrait à
 * laisser l'acheteur choisir le montant que la boutique absorbe.
 */
export function quoteShipping(
  input: {
    destination: ShippingDestination
    /** Poids de chaque article du panier, en grammes. */
    articleWeightsGrams: readonly number[]
    /** Sous-total articles, remises comprises. Sert au seuil de franchise. */
    subtotalCents: number
  },
  zones: readonly ShippingZoneGrid[],
  rates: readonly ShippingRateGrid[],
  config: ShippingConfig,
): ShippingResult {
  const resolved = resolveShippingZone(input.destination, zones)
  if (!resolved.ok) return { ok: false, failure: resolved.failure }

  const zone = resolved.zone
  const parcelWeightGrams = computeParcelWeightGrams(
    input.articleWeightsGrams,
    config,
  )

  const zoneRates = rates.filter((rate) => rate.zoneCode === zone.code)
  if (zoneRates.length === 0) {
    return { ok: false, failure: { reason: 'NO_RATE_FOR_ZONE', zoneCode: zone.code } }
  }

  const covered = maxCoveredGrams(zoneRates)
  if (parcelWeightGrams > covered) {
    // Aucune extrapolation : pas de règle de trois, pas de repli sur le palier
    // le plus lourd, pas de découpage automatique en plusieurs colis. Un poids
    // hors grille est une décision commerciale, pas un calcul.
    return {
      ok: false,
      failure: {
        reason: 'WEIGHT_NOT_COVERED',
        zoneCode: zone.code,
        weightGrams: parcelWeightGrams,
        maxCoveredGrams: covered,
      },
    }
  }

  // Un service peut proposer plusieurs paliers ; on retient pour chacun le
  // palier le plus étroit qui couvre le poids, donc le moins cher.
  const byService = new Map<string, ShippingRateGrid>()
  for (const rate of zoneRates) {
    if (rate.maxWeightGrams < parcelWeightGrams) continue
    const key = `${rate.carrierCode}:${rate.serviceCode}`
    const current = byService.get(key)
    if (!current || rate.maxWeightGrams < current.maxWeightGrams) {
      byService.set(key, rate)
    }
  }

  if (byService.size === 0) {
    return { ok: false, failure: { reason: 'NO_RATE_FOR_ZONE', zoneCode: zone.code } }
  }

  const priced = [...byService.values()]
    .map((rate) => ({
      rate,
      fullChargedCents: computeChargedShippingCents(rate.priceCents, config),
    }))
    // Tri stable et déterministe : prix, puis délai, puis libellé. Sans le
    // dernier critère, deux services au même tarif s'échangeraient d'un rendu
    // à l'autre et la « moins chère » ne serait pas reproductible.
    .sort(
      (a, b) =>
        a.fullChargedCents - b.fullChargedCents ||
        a.rate.deliveryDaysMax - b.rate.deliveryDaysMax ||
        a.rate.label.localeCompare(b.rate.label),
    )

  const cheapest = priced[0]
  if (!cheapest) {
    return { ok: false, failure: { reason: 'NO_RATE_FOR_ZONE', zoneCode: zone.code } }
  }

  const threshold = zone.freeShippingThresholdCents
  const freeShipping = threshold !== null && input.subtotalCents >= threshold

  const options: ShippingOption[] = priced.map((entry) => {
    // Hors franchise : le prix plein. Sous franchise : la différence avec
    // l'option la moins chère, jamais négative.
    const chargedCents = freeShipping
      ? Math.max(0, entry.fullChargedCents - cheapest.fullChargedCents)
      : entry.fullChargedCents

    return {
      carrierCode: entry.rate.carrierCode,
      serviceCode: entry.rate.serviceCode,
      label: entry.rate.label,
      carrierCostCents: entry.rate.priceCents,
      fullChargedCents: entry.fullChargedCents,
      chargedCents,
      freeShippingApplied: freeShipping && chargedCents === 0,
      deliveryDaysMin: entry.rate.deliveryDaysMin,
      deliveryDaysMax: entry.rate.deliveryDaysMax,
      requiresServicePoint: entry.rate.requiresServicePoint,
    }
  })

  const standard = options[0]
  if (!standard) {
    return { ok: false, failure: { reason: 'NO_RATE_FOR_ZONE', zoneCode: zone.code } }
  }

  return {
    ok: true,
    quote: {
      zone: {
        code: zone.code,
        name: zone.name,
        requiresCustoms: zone.requiresCustoms,
        freeShippingThresholdCents: zone.freeShippingThresholdCents,
      },
      parcelWeightGrams,
      options,
      standardChargedCents: standard.chargedCents,
    },
  }
}

/**
 * Retrouve une option dans un devis, par transporteur et service.
 *
 * Le choix de livraison arrive du client sous forme de deux identifiants. Ils
 * ne sont JAMAIS accompagnés d'un montant : le prix est celui du devis
 * recalculé, pas celui que le navigateur prétend avoir affiché.
 */
export function findQuotedOption(
  quote: ShippingQuote,
  choice: { carrierCode: string; serviceCode: string },
): ShippingOption | null {
  return (
    quote.options.find(
      (option) =>
        option.carrierCode === choice.carrierCode &&
        option.serviceCode === choice.serviceCode,
    ) ?? null
  )
}
