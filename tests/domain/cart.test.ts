import { describe, it, expect } from 'vitest'
import {
  evaluateCartLine,
  isPurchasable,
  needsAttention,
  computeCartSubtotalCents,
  purchasableWeightsGrams,
  tallyCart,
  type CartLineFacts,
  type CartLineState,
} from '@/lib/domain/cart'

/**
 * Qualification des lignes de panier.
 *
 * Le comportement figé ici est celui que le brief impose : une ligne n'est
 * JAMAIS supprimée en silence. Ces tests vérifient donc surtout ce qui reste
 * visible et ce qui reste payable, pas ce qui disparaît.
 */

const NOW = new Date('2026-08-13T12:00:00Z')
const MOI = 'jeton-a'
const AUTRE = 'jeton-b'

const facts = (over: Partial<CartLineFacts> = {}): CartLineFacts => ({
  snapshotUnitPriceCents: 2000,
  currentPriceCents: 2000,
  status: 'AVAILABLE',
  publishedAt: new Date('2026-08-01T00:00:00Z'),
  reservedById: null,
  reservedUntil: null,
  viewerLockOwnerId: MOI,
  now: NOW,
  ...over,
})

describe('qualification d’une ligne', () => {
  it('une pièce disponible au même prix est simplement bonne', () => {
    expect(evaluateCartLine(facts())).toEqual({ kind: 'ok' })
  })

  it('signale une baisse de prix sans bloquer l’achat', () => {
    // La boutique baisse ses prix automatiquement avec le temps : bloquer sur
    // une bonne nouvelle serait absurde.
    const state = evaluateCartLine(facts({ currentPriceCents: 1600 }))
    expect(state).toEqual({
      kind: 'price-lowered',
      snapshotCents: 2000,
      currentCents: 1600,
    })
    expect(isPurchasable(state)).toBe(true)
    expect(needsAttention(state)).toBe(true)
  })

  it('signale une hausse de prix sans bloquer l’achat', () => {
    const state = evaluateCartLine(facts({ currentPriceCents: 2400 }))
    expect(state.kind).toBe('price-raised')
    expect(isPurchasable(state)).toBe(true)
  })

  it('une pièce vendue reste visible mais n’est plus payable', () => {
    const state = evaluateCartLine(facts({ status: 'SOLD' }))
    expect(state).toEqual({ kind: 'sold' })
    expect(isPurchasable(state)).toBe(false)
  })

  it('« vendu » l’emporte sur un écart de prix', () => {
    // Afficher « le prix a baissé » sur une pièce déjà partie serait une
    // mauvaise plaisanterie.
    const state = evaluateCartLine(
      facts({ status: 'SOLD', currentPriceCents: 900 }),
    )
    expect(state.kind).toBe('sold')
  })

  it.each(['DRAFT', 'SCHEDULED', 'ARCHIVED'] as const)(
    'un article %s est indisponible',
    (status) => {
      expect(evaluateCartLine(facts({ status })).kind).toBe('unavailable')
    },
  )

  it('un article dépublié est indisponible', () => {
    expect(evaluateCartLine(facts({ publishedAt: null })).kind).toBe('unavailable')
  })

  it('un article programmé dans le futur est indisponible', () => {
    const state = evaluateCartLine(
      facts({ publishedAt: new Date('2026-09-01T00:00:00Z') }),
    )
    expect(state.kind).toBe('unavailable')
  })
})

describe('réservation', () => {
  const dans10min = new Date(NOW.getTime() + 10 * 60_000)
  const ilY5min = new Date(NOW.getTime() - 5 * 60_000)

  it('réservée par quelqu’un d’autre : visible, pas payable', () => {
    const state = evaluateCartLine(
      facts({ status: 'RESERVED', reservedById: AUTRE, reservedUntil: dans10min }),
    )
    expect(state).toEqual({ kind: 'reserved-by-other', until: dans10min })
    expect(isPurchasable(state)).toBe(false)
  })

  it('réservée par MOI : c’est mon propre paiement en cours, donc payable', () => {
    // Sans cette distinction, entrer dans le tunnel rendrait aussitôt son
    // propre panier impayable.
    const state = evaluateCartLine(
      facts({ status: 'RESERVED', reservedById: MOI, reservedUntil: dans10min }),
    )
    expect(state.kind).toBe('ok')
    expect(isPurchasable(state)).toBe(true)
  })

  it('un verrou expiré n’est pas un obstacle', () => {
    // Le balayage ne l'a pas encore libéré : ce n'est pas une raison de
    // refuser la vente.
    const state = evaluateCartLine(
      facts({ status: 'RESERVED', reservedById: AUTRE, reservedUntil: ilY5min }),
    )
    expect(isPurchasable(state)).toBe(true)
  })

  it('à la seconde exacte de l’échéance, le verrou est tombé', () => {
    const state = evaluateCartLine(
      facts({ status: 'RESERVED', reservedById: AUTRE, reservedUntil: NOW }),
    )
    expect(isPurchasable(state)).toBe(true)
  })

  it('un verrou sans échéance ne bloque pas une vente', () => {
    // Une contrainte CHECK interdit déjà cette combinaison en base ; une
    // donnée incohérente ne doit pas immobiliser un article.
    const state = evaluateCartLine(
      facts({ status: 'RESERVED', reservedById: AUTRE, reservedUntil: null }),
    )
    expect(isPurchasable(state)).toBe(true)
  })
})

describe('totaux', () => {
  const ligne = (
    currentPriceCents: number,
    state: CartLineState,
  ): { currentPriceCents: number; state: CartLineState } => ({
    currentPriceCents,
    state,
  })

  it('n’additionne que les lignes payables', () => {
    const total = computeCartSubtotalCents([
      ligne(2000, { kind: 'ok' }),
      ligne(1500, { kind: 'sold' }),
      ligne(1000, { kind: 'reserved-by-other', until: NOW }),
    ])
    expect(total).toBe(2000)
  })

  it('compte le prix COURANT, jamais celui mémorisé à l’ajout', () => {
    // Le prix mémorisé est un témoin d'écart, pas une valeur monétaire.
    const total = computeCartSubtotalCents([
      ligne(1600, { kind: 'price-lowered', snapshotCents: 2000, currentCents: 1600 }),
    ])
    expect(total).toBe(1600)
  })

  it('ne retient que le poids des lignes payables', () => {
    expect(
      purchasableWeightsGrams([
        { weightGrams: 200, state: { kind: 'ok' } },
        { weightGrams: 700, state: { kind: 'sold' } },
        { weightGrams: 500, state: { kind: 'price-raised', snapshotCents: 1, currentCents: 2 } },
      ]),
    ).toEqual([200, 500])
  })

  it('décompte les lignes bloquées sans les faire disparaître', () => {
    const tally = tallyCart([
      ligne(2000, { kind: 'ok' }),
      ligne(1500, { kind: 'sold' }),
      ligne(1000, { kind: 'unavailable' }),
    ])
    expect(tally).toEqual({
      total: 3,
      purchasable: 1,
      blocked: 2,
      subtotalCents: 2000,
    })
  })

  it('un panier vide ne vaut rien et ne bloque rien', () => {
    expect(tallyCart([])).toEqual({
      total: 0,
      purchasable: 0,
      blocked: 0,
      subtotalCents: 0,
    })
  })
})
