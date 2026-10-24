import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * L'encadré des garanties légales des CGV, contre le texte de la loi.
 *
 * L'article D211-2 du code de la consommation impose un encadré
 * « conformément aux modèles annexés » : c'est un texte à reproduire, pas une
 * idée à reformuler. La première version des CGV le paraphrasait, et la
 * paraphrase était plus étroite que la loi — elle n'ouvrait la réduction du
 * prix ou la résolution que si la réparation était impossible.
 *
 * La référence est l'annexe elle-même, relevée dans une édition consolidée du
 * code et versée dans `tests/fixtures/annexe-d211-2-a.txt`. Seule
 * l'apostrophe diffère : le projet écrit ’, parce que l'apostrophe droite est
 * un caractère d'échappement des messages ICU.
 *
 * Le jour où l'annexe change, ce test ne le saura pas tout seul : il faut
 * remplacer le fichier de référence par le nouveau texte, et il dira alors
 * précisément quoi corriger dans les CGV.
 */

const normaliser = (texte: string) =>
  texte
    .replace(/[’']/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim()

describe('l’encadré des garanties légales', () => {
  it('reproduit mot pour mot l’annexe A de l’article D211-2', () => {
    const reference = readFileSync(
      join(process.cwd(), 'tests', 'fixtures', 'annexe-d211-2-a.txt'),
      'utf8',
    )
      .split('\n')
      .filter((ligne) => !ligne.startsWith('#'))
      .join('\n')

    const messages = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'fr.json'), 'utf8'),
    ) as { legal: { terms: { warrantyBox: string } } }

    expect(normaliser(messages.legal.terms.warrantyBox)).toBe(
      normaliser(reference),
    )
  })

  it('dit, hors encadré, la règle propre aux biens d’occasion', () => {
    // L'encadré est générique : il ne connaît que les vingt-quatre mois de
    // présomption du neuf. Les pièces étant d'occasion, c'est douze mois
    // (L217-7), et les CGV doivent le dire à côté.
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'fr.json'), 'utf8'),
    ) as { legal: { terms: { warrantyBody: string } } }

    expect(messages.legal.terms.warrantyBody).toContain('douze mois')
    expect(messages.legal.terms.warrantyBody).toContain('L217-7')
  })
})
