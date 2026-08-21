import { describe, it, expect } from 'vitest'
import {
  computeParcelWeightGrams,
  computeChargedShippingCents,
  resolveShippingZone,
  quoteShipping,
  findQuotedOption,
  type ShippingConfig,
  type ShippingZoneGrid,
  type ShippingRateGrid,
} from '@/lib/domain/shipping'
import { ZONES, RATES } from '@/prisma/seed-data/shipping'

/**
 * Calcul du port.
 *
 * Les tests s'appuient sur la grille RÉELLE du seed plutôt que sur des tarifs
 * inventés : une grille de test diverge de la grille de production, et c'est
 * précisément là que se logent les erreurs de palier.
 */

const CONFIG: ShippingConfig = {
  packagingWeightGrams: 80,
  shippingMarkupPercent: 20,
}

const zones: ShippingZoneGrid[] = ZONES.map((zone) => ({
  code: zone.code,
  name: zone.name,
  countries: zone.countries,
  postalPrefixes: zone.postalPrefixes ?? [],
  freeShippingThresholdCents: zone.freeShippingThresholdCents,
  requiresCustoms: zone.requiresCustoms ?? false,
  position: zone.position,
}))

const rates: ShippingRateGrid[] = RATES.map((rate) => ({
  zoneCode: rate.zoneCode,
  carrierCode: rate.carrierCode,
  serviceCode: rate.serviceCode,
  label: rate.label,
  maxWeightGrams: rate.maxWeightGrams,
  priceCents: rate.priceCents,
  deliveryDaysMin: rate.deliveryDaysMin,
  deliveryDaysMax: rate.deliveryDaysMax,
  requiresServicePoint: rate.requiresServicePoint ?? false,
}))

const quote = (
  input: Partial<Parameters<typeof quoteShipping>[0]> = {},
): ReturnType<typeof quoteShipping> =>
  quoteShipping(
    {
      destination: { countryCode: 'FR', postalCode: '75001' },
      articleWeightsGrams: [200],
      subtotalCents: 1000,
      ...input,
    },
    zones,
    rates,
    CONFIG,
  )

describe('poids du colis', () => {
  it('ajoute l’emballage UNE fois, pas une fois par article', () => {
    // Cinq pièces ne veulent pas dire cinq cartons. Compter l'emballage par
    // article ferait franchir un palier tarifaire pour rien.
    expect(computeParcelWeightGrams([200, 200, 200, 200, 200], CONFIG)).toBe(1080)
  })

  it('vaut le seul emballage pour un panier vide', () => {
    expect(computeParcelWeightGrams([], CONFIG)).toBe(80)
  })
})

describe('majoration', () => {
  it('applique la majoration puis arrondit à la dizaine supérieure', () => {
    // 420 × 1,20 = 504 → 510
    expect(computeChargedShippingCents(420, CONFIG)).toBe(510)
  })

  it('n’arrondit pas vers le bas', () => {
    // 100 × 1,20 = 120, déjà rond : aucune retenue superflue.
    expect(computeChargedShippingCents(100, CONFIG)).toBe(120)
  })

  it('respecte une majoration nulle', () => {
    expect(
      computeChargedShippingCents(420, { ...CONFIG, shippingMarkupPercent: 0 }),
    ).toBe(420)
  })

  it('refuse une majoration négative', () => {
    // Garde reprise de la version supprimée de `pricing.ts` : ce n'est pas une
    // remise sur le port, c'est un réglage saisi de travers.
    expect(() =>
      computeChargedShippingCents(420, { ...CONFIG, shippingMarkupPercent: -10 }),
    ).toThrow()
  })

  it('calcule en entiers, sans passer par la virgule flottante', () => {
    // Le piège dormant qui a motivé la suppression du doublon : 1,00 € majoré
    // de 10 % vaut 1,10 €. En flottant, 1 × 1.1 donne 1.1000000000000001, donc
    // 111 après Math.ceil, donc 1,20 € après arrondi à la dizaine.
    expect(
      computeChargedShippingCents(100, { ...CONFIG, shippingMarkupPercent: 10 }),
    ).toBe(110)

    expect(
      computeChargedShippingCents(700, { ...CONFIG, shippingMarkupPercent: 10 }),
    ).toBe(770)
  })
})

describe('résolution de zone', () => {
  it('le code postal l’emporte sur le pays — Corse', () => {
    const resolved = resolveShippingZone(
      { countryCode: 'FR', postalCode: '20000' },
      zones,
    )
    expect(resolved.ok && resolved.zone.code).toBe('FR_CORSE')
  })

  it('la Nouvelle-Calédonie n’est pas la métropole', () => {
    // Régression : 988 manquait de la grille, Nouméa était donc facturée au
    // tarif de Paris — à un tiers du coût réel, en silence.
    const resolved = resolveShippingZone(
      { countryCode: 'FR', postalCode: '98800' },
      zones,
    )
    expect(resolved.ok && resolved.zone.code).toBe('FR_DOM')
  })

  it.each([
    ['97400', 'La Réunion'],
    ['98700', 'Polynésie française'],
    ['98600', 'Wallis-et-Futuna'],
  ])('%s (%s) part en outre-mer', (postalCode) => {
    const resolved = resolveShippingZone({ countryCode: 'FR', postalCode }, zones)
    expect(resolved.ok && resolved.zone.code).toBe('FR_DOM')
  })

  it('un code postal métropolitain reste en métropole', () => {
    const resolved = resolveShippingZone(
      { countryCode: 'FR', postalCode: '69003' },
      zones,
    )
    expect(resolved.ok && resolved.zone.code).toBe('FR')
  })

  it('exige le code postal quand le pays est discriminé', () => {
    // Sans code postal, choisir la métropole reviendrait à parier. La France
    // porte trois zones : on refuse plutôt que de deviner.
    const resolved = resolveShippingZone(
      { countryCode: 'FR', postalCode: null },
      zones,
    )
    expect(resolved.ok).toBe(false)
    expect(!resolved.ok && resolved.failure.reason).toBe('POSTAL_CODE_REQUIRED')
  })

  it('n’exige pas de code postal là où aucune zone n’en dépend', () => {
    const resolved = resolveShippingZone(
      { countryCode: 'BE', postalCode: null },
      zones,
    )
    expect(resolved.ok && resolved.zone.code).toBe('EU1')
  })

  it('accepte une casse et des espaces quelconques', () => {
    const resolved = resolveShippingZone(
      { countryCode: 'fr', postalCode: ' 20 000 ' },
      zones,
    )
    expect(resolved.ok && resolved.zone.code).toBe('FR_CORSE')
  })

  it('refuse un pays hors grille au lieu de le rattacher au plus proche', () => {
    const resolved = resolveShippingZone(
      { countryCode: 'JP', postalCode: '1000001' },
      zones,
    )
    expect(resolved.ok).toBe(false)
    expect(!resolved.ok && resolved.failure.reason).toBe('ZONE_UNKNOWN')
  })
})

describe('paliers de poids', () => {
  it('retient le palier le plus étroit qui couvre le poids', () => {
    // 200 g + 80 g d'emballage = 280 g → palier 500 g, point relais à 420.
    const result = quote({ articleWeightsGrams: [200] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.options[0]?.carrierCostCents).toBe(420)
  })

  it('bascule au palier suivant à la borne exacte', () => {
    // 420 g + 80 = 500 g : couvert par le palier 500.
    const at = quote({ articleWeightsGrams: [420] })
    expect(at.ok && at.quote.options[0]?.carrierCostCents).toBe(420)

    // 421 g + 80 = 501 g : le palier 500 ne couvre plus.
    const over = quote({ articleWeightsGrams: [421] })
    expect(over.ok && over.quote.options[0]?.carrierCostCents).toBe(480)
  })

  it('refuse un poids hors grille au lieu d’extrapoler', () => {
    // Aucune règle de trois, aucun repli sur le palier le plus lourd, aucun
    // découpage automatique en plusieurs colis : c'est une décision
    // commerciale, pas un calcul.
    const result = quote({ articleWeightsGrams: [6000] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('WEIGHT_NOT_COVERED')
    expect(
      result.failure.reason === 'WEIGHT_NOT_COVERED' &&
        result.failure.maxCoveredGrams,
    ).toBe(5000)
  })
})

describe('franchise de port', () => {
  it('n’offre rien sous le seuil', () => {
    const result = quote({ subtotalCents: 3999 })
    expect(result.ok && result.quote.options[0]?.chargedCents).toBe(510)
    expect(result.ok && result.quote.options[0]?.freeShippingApplied).toBe(false)
  })

  it('offre l’option la moins chère à partir du seuil exact', () => {
    const result = quote({ subtotalCents: 4000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [cheapest] = result.quote.options
    expect(cheapest?.chargedCents).toBe(0)
    expect(cheapest?.freeShippingApplied).toBe(true)
    // Le prix plein reste exposé : c'est lui qu'on barre à l'affichage.
    expect(cheapest?.fullChargedCents).toBe(510)
  })

  it('facture la DIFFÉRENCE sur une option plus chère', () => {
    // Offrir l'option la plus chère laisserait l'acheteur choisir le montant
    // que la boutique absorbe.
    const result = quote({ subtotalCents: 4000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const home = result.quote.options.find((o) => o.serviceCode === 'COL_HOME')
    // Domicile 560 → 680 plein ; relais 420 → 510 offert ; reste 170.
    expect(home?.fullChargedCents).toBe(680)
    expect(home?.chargedCents).toBe(170)
    expect(home?.freeShippingApplied).toBe(false)
  })

  it('ignore le seuil dans une zone qui n’en a pas', () => {
    // La Corse n'a pas de franchise : un gros panier y paie le port.
    const result = quote({
      destination: { countryCode: 'FR', postalCode: '20000' },
      subtotalCents: 50_000,
    })
    expect(result.ok && result.quote.options[0]?.chargedCents).toBeGreaterThan(0)
  })

  it('applique le seuil EU1, distinct de celui de France', () => {
    const sous = quote({
      destination: { countryCode: 'BE', postalCode: '1000' },
      subtotalCents: 7999,
    })
    expect(sous.ok && sous.quote.options[0]?.chargedCents).toBeGreaterThan(0)

    const au = quote({
      destination: { countryCode: 'BE', postalCode: '1000' },
      subtotalCents: 8000,
    })
    expect(au.ok && au.quote.options[0]?.chargedCents).toBe(0)
  })
})

describe('plafond de remboursement du port', () => {
  it('retient l’option la moins chère, franchise comprise', () => {
    // L221-24 du code de la consommation : le remboursement des frais de
    // livraison est plafonné au mode standard le moins onéreux proposé.
    const paye = quote({ subtotalCents: 1000 })
    expect(paye.ok && paye.quote.standardChargedCents).toBe(510)

    const offert = quote({ subtotalCents: 4000 })
    expect(offert.ok && offert.quote.standardChargedCents).toBe(0)
  })
})

describe('choix de l’acheteur', () => {
  it('retrouve une option par transporteur et service', () => {
    const result = quote()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const option = findQuotedOption(result.quote, {
      carrierCode: 'colissimo',
      serviceCode: 'COL_HOME',
    })
    expect(option?.label).toBe('À domicile')
  })

  it('renvoie null pour un service inexistant plutôt que de retomber sur un autre', () => {
    const result = quote()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(
      findQuotedOption(result.quote, {
        carrierCode: 'inventé',
        serviceCode: 'INVENTÉ',
      }),
    ).toBeNull()
  })
})

describe('déterminisme', () => {
  it('trie les options par prix, puis délai, puis libellé', () => {
    // Sans troisième critère, deux services au même tarif s'échangeraient d'un
    // rendu à l'autre : la « moins chère » cesserait d'être reproductible, et
    // le plafond de remboursement avec elle.
    const result = quote()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const prices = result.quote.options.map((o) => o.fullChargedCents)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it('rend exactement le même devis à deux appels identiques', () => {
    expect(JSON.stringify(quote())).toBe(JSON.stringify(quote()))
  })
})

describe('douane', () => {
  it('signale les zones exigeant une déclaration', () => {
    const dom = quote({
      destination: { countryCode: 'FR', postalCode: '98800' },
      articleWeightsGrams: [200],
    })
    expect(dom.ok && dom.quote.zone.requiresCustoms).toBe(true)

    const metropole = quote()
    expect(metropole.ok && metropole.quote.zone.requiresCustoms).toBe(false)
  })
})
