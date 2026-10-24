import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CGV_VERSION } from '@/lib/config/pages'

/**
 * Le texte des CGV ne change pas sans que sa VERSION change.
 *
 * Chaque commande enregistre la version acceptée, comme preuve. Si le texte
 * change et que la version reste la même, la preuve désigne des conditions
 * que personne n'a lues — et le seed, qui n'écrasait aucun réglage en
 * production, gardait l'ancienne version même après une refonte complète.
 *
 * Quand ce test échoue : relire le changement, augmenter `CGV_VERSION` dans
 * `lib/config/pages.ts`, puis recopier ici l'empreinte qu'il annonce.
 */

const EMPREINTES: Record<string, string> = {
  '2026-10': 'e26b6927235e7524b187794bee19a15da8eed46138bc54509928c2a9baea75d5',
}

describe('la version des CGV', () => {
  it('correspond au texte français publié', () => {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'fr.json'), 'utf8'),
    ) as { legal: { terms: unknown } }
    const empreinte = createHash('sha256')
      .update(JSON.stringify(messages.legal.terms))
      .digest('hex')

    expect(
      empreinte,
      `Le texte des CGV a changé : augmentez CGV_VERSION (aujourd’hui ${CGV_VERSION}) et enregistrez l’empreinte ${empreinte}.`,
    ).toBe(EMPREINTES[CGV_VERSION])
  })
})
