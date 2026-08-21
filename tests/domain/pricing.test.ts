import { describe, it, expect } from 'vitest'
import {
  computeFloorPriceCents,
  computeNetMarginCents,
  computeAutoDropPriceCents,
  roundUpToTenCents,
  stripeFeeCents,
  contributionCents,
  DEFAULT_PRICING_CONFIG,
} from '@/lib/domain/pricing'

describe('roundUpToTenCents', () => {
  it('arrondit vers le haut à la dizaine de centimes', () => {
    expect(roundUpToTenCents(0)).toBe(0)
    expect(roundUpToTenCents(1)).toBe(10)
    expect(roundUpToTenCents(10)).toBe(10)
    expect(roundUpToTenCents(11)).toBe(20)
    expect(roundUpToTenCents(499)).toBe(500)
  })
})

describe('stripeFeeCents', () => {
  it('applique la part variable et la part fixe', () => {
    // 20,00 € → 1,50 % = 30 centimes, + 25 centimes fixes.
    expect(stripeFeeCents(2000)).toBe(55)
  })

  it('arrondit la part variable au centime supérieur', () => {
    // 1,00 € → 1,5 centime, arrondi à 2, + 25.
    expect(stripeFeeCents(100)).toBe(27)
  })
})

describe('contributionCents', () => {
  it('applique le taux de cotisations au chiffre d’affaires', () => {
    expect(contributionCents(10_000)).toBe(1230)
  })
})

describe('computeFloorPriceCents', () => {
  it('couvre coût, port, prélèvements et marge minimale', () => {
    const floor = computeFloorPriceCents({
      costCents: 500,
      estimatedShippingCostCents: 420,
    })

    // Le plancher doit dégager au moins la marge minimale visée.
    const margin = computeNetMarginCents({
      salePriceCents: floor,
      costCents: 500,
      shippingCostCents: 420,
    })

    expect(margin).toBeGreaterThanOrEqual(
      DEFAULT_PRICING_CONFIG.minMarginCents,
    )
  })

  it('reste au-dessus de la marge minimale sur toute une plage de coûts', () => {
    for (let cost = 0; cost <= 5000; cost += 137) {
      for (const shipping of [0, 420, 890, 2200]) {
        const floor = computeFloorPriceCents({
          costCents: cost,
          estimatedShippingCostCents: shipping,
        })
        const margin = computeNetMarginCents({
          salePriceCents: floor,
          costCents: cost,
          shippingCostCents: shipping,
        })

        expect(
          margin,
          `coût=${cost} port=${shipping} plancher=${floor}`,
        ).toBeGreaterThanOrEqual(DEFAULT_PRICING_CONFIG.minMarginCents)
      }
    }
  })

  it('croît avec le coût d’achat', () => {
    const cheap = computeFloorPriceCents({
      costCents: 200,
      estimatedShippingCostCents: 420,
    })
    const expensive = computeFloorPriceCents({
      costCents: 2000,
      estimatedShippingCostCents: 420,
    })
    expect(expensive).toBeGreaterThan(cheap)
  })

  it('refuse une configuration où les prélèvements atteignent 100 %', () => {
    expect(() =>
      computeFloorPriceCents(
        { costCents: 500, estimatedShippingCostCents: 0 },
        {
          contributionRateBps: 6000,
          stripePercentBps: 4000,
          stripeFixedCents: 25,
          minMarginCents: 300,
        },
      ),
    ).toThrow()
  })
})

describe('computeNetMarginCents', () => {
  it('fait supporter les prélèvements au port facturé', () => {
    const sansPort = computeNetMarginCents({
      salePriceCents: 2000,
      shippingChargedCents: 0,
      costCents: 500,
      shippingCostCents: 0,
    })
    const avecPort = computeNetMarginCents({
      salePriceCents: 2000,
      shippingChargedCents: 500,
      costCents: 500,
      shippingCostCents: 500,
    })

    // Facturer le port à son coût exact fait PERDRE de l'argent : c'est
    // précisément la raison d'être de shippingMarkupPercent.
    expect(avecPort).toBeLessThan(sansPort)
  })

  it('peut être négatif si le prix passe sous le plancher', () => {
    const margin = computeNetMarginCents({
      salePriceCents: 500,
      costCents: 900,
      shippingCostCents: 420,
    })
    expect(margin).toBeLessThan(0)
  })
})

describe('computeAutoDropPriceCents', () => {
  it('applique la baisse demandée', () => {
    expect(
      computeAutoDropPriceCents({
        basePriceCents: 2000,
        floorPriceCents: 1000,
        percent: 10,
      }),
    ).toBe(1800)
  })

  it('ne descend jamais sous le plancher', () => {
    expect(
      computeAutoDropPriceCents({
        basePriceCents: 1200,
        floorPriceCents: 1150,
        percent: 20,
      }),
    ).toBe(1150)
  })
})
