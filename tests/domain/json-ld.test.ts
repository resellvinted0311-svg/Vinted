import { describe, it, expect } from 'vitest'
import { serializeJsonLd, absoluteImageUrl } from '@/lib/utils/json-ld'

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

/**
 * L'adresse d'image publiée dans le bloc Product.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ces tests ont attrapé
 * ---------------------------------------------------------------------------
 * La fiche article préfixait l'adresse de chaque visuel par `SITE.url`, sans
 * condition. Cela suppose une adresse relative — ce qui est vrai du seul jeu
 * de démonstration. En production, `ArticleImage.url` porte le `secure_url`
 * absolu de Cloudinary, et le préfixe produisait :
 *
 *   https://boutique.frhttps://res.cloudinary.com/…
 *
 * Une image invalide invalide le résultat enrichi ENTIER : la fiche perd sa
 * vignette, son prix et sa disponibilité dans les résultats de recherche.
 *
 * Le défaut ne pouvait pas être vu en test tant que le seul cas testé était
 * celui, unique, où la concaténation tombait juste. C'est le sens du premier
 * test ci-dessous.
 */
describe('adresse d’image absolue', () => {
  const SITE_URL = 'https://boutique.example'

  it('ne préfixe pas une adresse déjà absolue', () => {
    const cloudinary =
      'https://res.cloudinary.com/nina/image/upload/v1/articles/veste.jpg'

    expect(absoluteImageUrl(cloudinary, SITE_URL)).toBe(cloudinary)
    expect(absoluteImageUrl(cloudinary, SITE_URL)).not.toContain(
      'boutique.examplehttps',
    )
  })

  it('préfixe une adresse relative, comme celles du jeu de démonstration', () => {
    expect(absoluteImageUrl('/seed/veste.svg', SITE_URL)).toBe(
      'https://boutique.example/seed/veste.svg',
    )
  })

  it('traite http comme https, et ignore la casse du protocole', () => {
    // Un environnement de recette sert en clair ; une adresse recopiée peut
    // porter un protocole en majuscules. Dans les deux cas elle est absolue.
    expect(absoluteImageUrl('http://localhost:3000/a.png', SITE_URL)).toBe(
      'http://localhost:3000/a.png',
    )
    expect(absoluteImageUrl('HTTPS://res.cloudinary.com/a.jpg', SITE_URL)).toBe(
      'HTTPS://res.cloudinary.com/a.jpg',
    )
  })

  it('ne réécrit pas une adresse étrangère en la faisant passer pour la nôtre', () => {
    // Publier une adresse qu'on ne sert pas est un défaut ; prétendre la
    // servir en est un plus grave. Les hôtes autorisés sont verrouillés au
    // rendu par `next.config.ts`, pas ici.
    const etranger = 'https://exemple-inconnu.test/photo.jpg'
    expect(absoluteImageUrl(etranger, SITE_URL)).toBe(etranger)
  })
})
