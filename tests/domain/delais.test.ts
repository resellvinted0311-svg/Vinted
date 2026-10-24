import { describe, it, expect } from 'vitest'
import { apresJours, apresJoursOuvrable } from '@/lib/domain/delais'

/**
 * Les délais de la rétractation, en jours de calendrier à l'heure de Paris.
 *
 * La première version ajoutait 14 × 24 h : elle annonçait un jour de moins à
 * qui se rétractait juste avant un changement d'heure, sur la pièce même que
 * la personne doit garder.
 */

const jour = (date: Date) => date.toISOString().slice(0, 10)

describe('quatorze jours de calendrier', () => {
  it('ne perdent pas un jour au passage à l’heure d’hiver', () => {
    // 20 octobre 2026, 0 h 30 à Paris — l'heure change le 25.
    expect(jour(apresJours(new Date('2026-10-19T22:30:00Z'), 14))).toBe(
      '2026-11-03',
    )
  })

  it('n’en gagnent pas un au passage à l’heure d’été', () => {
    // 20 mars 2027, 23 h 30 à Paris — l'heure change le 28.
    expect(jour(apresJours(new Date('2027-03-20T22:30:00Z'), 14))).toBe(
      '2027-04-03',
    )
  })
})

describe('le report au premier jour ouvrable', () => {
  it('saute le week-end', () => {
    // Samedi 24 octobre + 14 = samedi 7 novembre → lundi 9.
    expect(jour(apresJoursOuvrable(new Date('2026-10-24T10:00:00Z'), 14))).toBe(
      '2026-11-09',
    )
  })

  it('saute un jour férié fixe', () => {
    // Mercredi 28 octobre + 14 = mercredi 11 novembre, férié → jeudi 12.
    expect(jour(apresJoursOuvrable(new Date('2026-10-28T10:00:00Z'), 14))).toBe(
      '2026-11-12',
    )
  })

  it('saute le lundi de Pâques, qui se calcule', () => {
    // Dimanche 22 mars 2026 + 14 = dimanche 5 avril, Pâques ; lundi 6 férié.
    expect(jour(apresJoursOuvrable(new Date('2026-03-22T10:00:00Z'), 14))).toBe(
      '2026-04-07',
    )
  })

  it('ne touche pas une échéance qui tombe un jour ouvrable', () => {
    expect(jour(apresJoursOuvrable(new Date('2026-10-21T10:00:00Z'), 14))).toBe(
      '2026-11-04',
    )
  })
})
