import { describe, it, expect } from 'vitest'
import { serializeJsonLd } from '@/lib/utils/json-ld'

/**
 * Sérialisation JSON-LD.
 *
 * Ce test existe à cause d'une faille réelle : `JSON.stringify` n'échappe rien
 * de HTML, et une description d'article pouvait donc fermer la balise `script`
 * qui la contenait, puis exécuter du code chez chaque visiteur de la fiche.
 *
 * Le premier test est le garde-fou : il doit échouer si quelqu'un remplace un
 * jour l'appel par un `JSON.stringify` nu.
 */

const CLOTURE = '</script>'

describe('neutralisation du HTML', () => {
  it('une fermeture de balise script ne survit pas', () => {
    const sortie = serializeJsonLd({
      description: `${CLOTURE}<script>alert(1)</script>`,
    })

    expect(sortie).not.toContain(CLOTURE)
    expect(sortie).not.toContain('<script>')
    expect(sortie).toContain('\\u003c')
  })

  it('échappe aussi le chevron fermant et l’esperluette', () => {
    const sortie = serializeJsonLd({ t: '<a href="x">&amp;</a>' })
    expect(sortie).not.toMatch(/[<>&]/)
  })

  it('neutralise les séparateurs de ligne Unicode', () => {
    // Légaux en JSON, terminateurs de ligne en JavaScript : ils cassent
    // l'analyse du bloc sans qu'aucun caractère visible ne l'annonce.
    const sortie = serializeJsonLd({
      t: `a${String.fromCodePoint(0x2028)}b${String.fromCodePoint(0x2029)}c`,
    })

    expect(sortie).toContain('\\u2028')
    expect(sortie).toContain('\\u2029')
    expect(sortie).not.toContain(String.fromCodePoint(0x2028))
    expect(sortie).not.toContain(String.fromCodePoint(0x2029))
  })
})

describe('fidélité', () => {
  it('reste du JSON valide, relu à l’identique', () => {
    // L'échappement Unicode est du JSON parfaitement légal : les moteurs
    // d'indexation relisent la donnée sans perte. Si ce test échoue, le
    // référencement structuré casse.
    const donnee = {
      '@context': 'https://schema.org',
      name: 'Chemise <Ralph & Lauren>',
      description: `Coupe droite${String.fromCodePoint(0x2028)}coton`,
      price: '38.00',
      nested: { list: [1, 2, 3], flag: true, nothing: null },
    }

    expect(JSON.parse(serializeJsonLd(donnee))).toEqual(donnee)
  })

  it('ne touche pas à une charge sans caractère sensible', () => {
    const donnee = { name: 'Pull Uniqlo', size: 'M' }
    expect(serializeJsonLd(donnee)).toBe(JSON.stringify(donnee))
  })
})
