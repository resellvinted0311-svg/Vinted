import { describe, it, expect } from 'vitest'
import {
  computeFloorPriceCents,
  computeNetMarginCents,
  computeAutoDropPriceCents,
  dueDropStage,
  roundUpToTenCents,
  stripeFeeCents,
  contributionCents,
  type PricingConfig,
} from '@/lib/domain/pricing'

/**
 * La configuration sous laquelle ces attentes sont vraies.
 *
 * Elle est ÉCRITE ICI, et non importée d'une constante partagée. C'est
 * délibéré : « 20,00 € donne 55 centimes de commission » n'a de sens qu'en
 * regard d'un taux, et un test qui importe son taux d'ailleurs se met à passer
 * ou à tomber quand ce taux change — sans que le test ait rien à dire sur le
 * changement.
 *
 * Depuis que `lib/domain/pricing.ts` n'a plus de configuration par défaut, ce
 * fichier est aussi le seul endroit du dépôt où ces nombres figurent à côté de
 * leurs résultats attendus. Ils ne décrivent aucune boutique réelle.
 */
const CONFIG: PricingConfig = {
  contributionRateBps: 1230,
  stripePercentBps: 150,
  stripeFixedCents: 25,
  minMarginCents: 300,
}

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
    expect(stripeFeeCents(2000, CONFIG)).toBe(55)
  })

  it('arrondit la part variable au centime supérieur', () => {
    // 1,00 € → 1,5 centime, arrondi à 2, + 25.
    expect(stripeFeeCents(100, CONFIG)).toBe(27)
  })
})

describe('contributionCents', () => {
  it('applique le taux de cotisations au chiffre d’affaires', () => {
    expect(contributionCents(10_000, CONFIG)).toBe(1230)
  })
})

describe('computeFloorPriceCents', () => {
  it('couvre coût, port, prélèvements et marge minimale', () => {
    const floor = computeFloorPriceCents({
      costCents: 500,
      estimatedShippingCostCents: 420,
    }, CONFIG)

    // Le plancher doit dégager au moins la marge minimale visée.
    const margin = computeNetMarginCents({
      salePriceCents: floor,
      costCents: 500,
      shippingCostCents: 420,
    }, CONFIG)

    expect(margin).toBeGreaterThanOrEqual(
      CONFIG.minMarginCents,
    )
  })

  it('reste au-dessus de la marge minimale sur toute une plage de coûts', () => {
    for (let cost = 0; cost <= 5000; cost += 137) {
      for (const shipping of [0, 420, 890, 2200]) {
        const floor = computeFloorPriceCents({
          costCents: cost,
          estimatedShippingCostCents: shipping,
        }, CONFIG)
        const margin = computeNetMarginCents({
          salePriceCents: floor,
          costCents: cost,
          shippingCostCents: shipping,
        }, CONFIG)

        expect(
          margin,
          `coût=${cost} port=${shipping} plancher=${floor}`,
        ).toBeGreaterThanOrEqual(CONFIG.minMarginCents)
      }
    }
  })

  it('croît avec le coût d’achat', () => {
    const cheap = computeFloorPriceCents({
      costCents: 200,
      estimatedShippingCostCents: 420,
    }, CONFIG)
    const expensive = computeFloorPriceCents({
      costCents: 2000,
      estimatedShippingCostCents: 420,
    }, CONFIG)
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
    }, CONFIG)
    const avecPort = computeNetMarginCents({
      salePriceCents: 2000,
      shippingChargedCents: 500,
      costCents: 500,
      shippingCostCents: 500,
    }, CONFIG)

    // Facturer le port à son coût exact fait PERDRE de l'argent : c'est
    // précisément la raison d'être de shippingMarkupPercent.
    expect(avecPort).toBeLessThan(sansPort)
  })

  it('peut être négatif si le prix passe sous le plancher', () => {
    const margin = computeNetMarginCents({
      salePriceCents: 500,
      costCents: 900,
      shippingCostCents: 420,
    }, CONFIG)
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

describe('dueDropStage', () => {
  const NOW = new Date('2026-08-20T12:00:00.000Z')
  const DAY = 24 * 60 * 60 * 1000
  const publishedDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

  const SCHEDULE = [
    { days: 30, percent: 10 },
    { days: 60, percent: 20 },
  ]

  it('ne doit rien avant le premier palier', () => {
    expect(dueDropStage(SCHEDULE, publishedDaysAgo(29), NOW)).toBeNull()
  })

  it('doit le premier palier à trente jours révolus', () => {
    expect(dueDropStage(SCHEDULE, publishedDaysAgo(30), NOW)).toEqual({
      days: 30,
      percent: 10,
    })
    expect(dueDropStage(SCHEDULE, publishedDaysAgo(59), NOW)).toEqual({
      days: 30,
      percent: 10,
    })
  })

  it('doit le DERNIER palier atteint, pas le premier', () => {
    // Une pièce de soixante-dix jours jamais baissée — cron en panne, barème
    // tout juste activé — va directement à −20 %. Le barème dit où le prix
    // DOIT être, pas par où il aurait dû passer.
    expect(dueDropStage(SCHEDULE, publishedDaysAgo(70), NOW)).toEqual({
      days: 60,
      percent: 20,
    })
  })

  it('ne suppose pas le barème trié', () => {
    const reversed = [...SCHEDULE].reverse()
    expect(dueDropStage(reversed, publishedDaysAgo(70), NOW)).toEqual({
      days: 60,
      percent: 20,
    })
    expect(dueDropStage(reversed, publishedDaysAgo(35), NOW)).toEqual({
      days: 30,
      percent: 10,
    })
  })

  it('un barème vide ne doit jamais rien', () => {
    expect(dueDropStage([], publishedDaysAgo(300), NOW)).toBeNull()
  })
})
