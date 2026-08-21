import { describe, it, expect } from 'vitest'
import {
  computeOrderAmounts,
  assertLinesMatchTotal,
  OrderTotalMismatchError,
} from '@/lib/domain/order-total'

/**
 * Ce que ces tests protègent : le montant débité d'une carte.
 *
 * Un écart d'un centime entre notre total et la somme des lignes envoyées au
 * prestataire ne lève aucune erreur visible — le prestataire débite SA somme,
 * notre base garde la nôtre — et se découvre à la comptabilité.
 */

describe('montants d’une commande', () => {
  it('additionne les lignes et le port', () => {
    const amounts = computeOrderAmounts({
      itemPricesCents: [1200, 2500, 800],
      shippingCents: 490,
    })

    expect(amounts.subtotalCents).toBe(4500)
    expect(amounts.shippingCents).toBe(490)
    expect(amounts.totalCents).toBe(4990)
  })

  it('accepte un panier d’une seule pièce', () => {
    const amounts = computeOrderAmounts({
      itemPricesCents: [1500],
      shippingCents: 0,
    })

    expect(amounts.totalCents).toBe(1500)
  })

  it('n’invente pas de remise', () => {
    const amounts = computeOrderAmounts({
      itemPricesCents: [1000],
      shippingCents: 300,
    })

    expect(amounts.discountCents).toBe(0)
  })

  it('plafonne la remise au sous-total, jamais au-delà', () => {
    // Une remise ne rend pas une commande négative, et surtout elle ne mange
    // pas le port : offrir la livraison se décide dans la franchise, pas par
    // débordement d'un code promotionnel.
    const amounts = computeOrderAmounts({
      itemPricesCents: [1000],
      shippingCents: 490,
      discountCents: 5000,
    })

    expect(amounts.discountCents).toBe(1000)
    expect(amounts.totalCents).toBe(490)
  })

  it('reste entier de bout en bout', () => {
    const amounts = computeOrderAmounts({
      itemPricesCents: [333, 333, 334],
      shippingCents: 111,
    })

    expect(Number.isInteger(amounts.totalCents)).toBe(true)
    expect(amounts.totalCents).toBe(1111)
  })
})

describe('cohérence avec les lignes envoyées au paiement', () => {
  it('laisse passer une somme exacte', () => {
    expect(() => {
      assertLinesMatchTotal([1200, 2500, 490], 4190)
    }).not.toThrow()
  })

  it('refuse un écart d’un seul centime', () => {
    // C'est tout l'intérêt : un centime ne se voit pas, et se paie en heures
    // de rapprochement bancaire.
    expect(() => {
      assertLinesMatchTotal([1200, 2500, 490], 4191)
    }).toThrow(OrderTotalMismatchError)
  })

  it('refuse une ligne oubliée', () => {
    expect(() => {
      assertLinesMatchTotal([1200, 2500], 4190)
    }).toThrow(OrderTotalMismatchError)
  })

  it('ne cite jamais autre chose que des montants dans son message', () => {
    try {
      assertLinesMatchTotal([100], 200)
      throw new Error('aurait dû lever')
    } catch (error) {
      expect((error as Error).message).toContain('100')
      expect((error as Error).message).toContain('200')
    }
  })
})
