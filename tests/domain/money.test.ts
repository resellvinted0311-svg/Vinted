import { describe, it, expect } from 'vitest'
import { parseAmountToCents } from '@/lib/domain/money'

/**
 * Ce que ce test protège : le montant qu'une personne croit avoir proposé.
 *
 * Sur un formulaire d'offre, ce nombre engage. Une lecture partielle — « 32 »
 * dans « 32,5,0 » — ferait proposer un prix que personne n'a saisi, et le
 * vendeur pourrait l'accepter.
 */
describe('lecture d’un montant saisi', () => {
  it('lit les deux séparateurs décimaux', () => {
    // La virgule pour sept des huit langues du site, le point pour la huitième
    // et pour les claviers numériques.
    expect(parseAmountToCents('32,50')).toBe(3250)
    expect(parseAmountToCents('32.50')).toBe(3250)
  })

  it('complète une seule décimale à droite', () => {
    // `padEnd` et non `padStart` : 32,5 € font 32,50 € et non 32,05 €.
    expect(parseAmountToCents('32,5')).toBe(3250)
    expect(parseAmountToCents('32,05')).toBe(3205)
  })

  it('lit un entier sans décimales', () => {
    expect(parseAmountToCents('32')).toBe(3200)
    expect(parseAmountToCents('0')).toBe(0)
  })

  it('n’introduit aucun flottant', () => {
    // `32.50 * 100` vaut 3250.0000000000005 en virgule flottante. Ici, la
    // partie entière et les décimales sont lues comme deux entiers.
    for (const value of ['0,07', '1,10', '8,29', '1234,56', '99999,99']) {
      const cents = parseAmountToCents(value)
      expect(Number.isInteger(cents), value).toBe(true)
    }
    expect(parseAmountToCents('1,10')).toBe(110)
    expect(parseAmountToCents('8,29')).toBe(829)
  })

  it('tolère les espaces autour', () => {
    expect(parseAmountToCents('  32,50  ')).toBe(3250)
  })

  it('refuse ce qui n’est pas un montant, plutôt que d’en deviner un', () => {
    for (const value of [
      '',
      '   ',
      'environ 32',
      '32,5,0',
      '32 50',
      '32,505',
      '-32',
      '+32',
      '32€',
      '1e3',
      'NaN',
      'Infinity',
      ',50',
      '32.',
    ]) {
      expect(Number.isNaN(parseAmountToCents(value)), value).toBe(true)
    }
  })

  it('refuse une valeur de repli silencieuse', () => {
    // Renvoyer zéro passerait la validation de forme et proposerait 0,00 €.
    expect(parseAmountToCents('abc')).not.toBe(0)
  })
})
