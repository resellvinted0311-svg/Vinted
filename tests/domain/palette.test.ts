import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La palette tient ses promesses de lisibilité.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce test relit le FICHIER
 * ---------------------------------------------------------------------------
 * Un tableau de couleurs recopié ici serait une note prise au moment du choix,
 * et il continuerait de passer longtemps après que quelqu'un a éclairci un rose
 * dans `globals.css`. On extrait donc les valeurs de la feuille de style
 * elle-même : le test ne peut pas diverger de ce que le site affiche.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'il empêche vraiment
 * ---------------------------------------------------------------------------
 * Une couleur d'accent se choisit à l'œil, sur un grand aplat, en plein jour.
 * Elle se LIT ensuite en petits caractères, sur un fond crème, par quelqu'un
 * dont la vue n'est pas celle de qui l'a choisie. Les deux moments n'ont rien à
 * voir, et c'est entre eux que la lisibilité se perd — sans que rien n'échoue,
 * sans qu'aucune page ne casse.
 *
 * Le seuil est celui du RGAA et des WCAG niveau AA : 4,5:1 pour du texte
 * courant. La boutique vend à des particuliers dans huit pays européens ;
 * l'accessibilité y est une obligation, pas une option de confort.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

/**
 * Les jetons d'un bloc de thème, extraits par la portée qui les déclare.
 *
 * On découpe sur l'accolade ouvrante du sélecteur puis on lit jusqu'à la
 * fermeture correspondante — la feuille imbrique des `@media`, donc un simple
 * « jusqu'au prochain } » attraperait le bloc voisin.
 */
function jetonsDe(selecteur: string): Map<string, string> {
  const debut = CSS.indexOf(selecteur)
  expect(debut, `bloc « ${selecteur} » introuvable`).toBeGreaterThan(-1)

  let profondeur = 0
  let i = CSS.indexOf('{', debut)
  const ouverture = i

  for (; i < CSS.length; i += 1) {
    if (CSS[i] === '{') profondeur += 1
    else if (CSS[i] === '}') {
      profondeur -= 1
      if (profondeur === 0) break
    }
  }

  const bloc = CSS.slice(ouverture, i)
  const jetons = new Map<string, string>()

  for (const [, nom, valeur] of bloc.matchAll(
    /(--[a-z-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g,
  )) {
    if (nom && valeur) jetons.set(nom, valeur)
  }

  return jetons
}

/** Luminance relative, telle que la définissent les WCAG. */
function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const large =
    n.length === 3
      ? [...n].map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))

  const [r, g, b] = large.map((octet) => {
    const canal = octet / 255
    return canal <= 0.03928
      ? canal / 12.92
      : Math.pow((canal + 0.055) / 1.055, 2.4)
  }) as [number, number, number]

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Rapport de contraste entre deux couleurs, de 1:1 à 21:1. */
export function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (clair + 0.05) / (sombre + 0.05)
}

/** Le seuil AA pour du texte courant. */
const AA = 4.5

/**
 * Les paires qui portent RÉELLEMENT du texte.
 *
 * Pas toutes les combinaisons possibles : seulement celles que l'interface
 * compose vraiment. Un rose sur un cuivre ne se rencontre nulle part, et
 * l'exiger ferait échouer le test sur une situation qui n'existe pas.
 */
const PAIRES: ReadonlyArray<readonly [string, string, string]> = [
  ['--ink', '--paper', 'le texte courant sur le fond de page'],
  ['--ink', '--surface', 'le texte d’une fiche'],
  ['--muted', '--paper', 'les mentions secondaires — les plus fragiles'],
  ['--muted', '--surface', 'les mentions secondaires d’une fiche'],
  ['--mark', '--paper', 'le tampon, qui est du texte et non un aplat'],
  ['--stamp', '--paper', 'le rose quand il porte un libellé'],
  ['--danger', '--paper', 'un refus'],
  ['--danger', '--surface', 'un refus dans une fiche'],
  ['--success', '--paper', 'une confirmation'],
  ['--warning', '--paper', 'un avertissement'],

  /*
    Les DEUX extrémités du dégradé, maintenant qu'il porte des surfaces.

    Le bandeau de faits et la section d'entrée du catalogue sont peints avec
    `--gradient-accent`, et du texte les traverse de bout en bout. Vérifier
    `--ink-inverse` sur `--stamp` seul ne prouvait la lisibilité qu'au DÉPART
    du dégradé : le libellé aurait pu s'éteindre en cours de route, du côté
    cuivre, sans qu'aucun test ne bronche.
  */
  ['--ink-inverse', '--stamp', 'le libellé au départ du dégradé'],
  ['--ink-inverse', '--mark', 'le même libellé à son arrivée'],

  /*
    Les titres de section portent désormais le dégradé dans leurs lettres, et
    ces sections sont posées sur `--paper-raised`, pas sur `--paper`.

    Ce n'est pas un détail en thème sombre : `--paper-raised` y est plus CLAIR
    que `--paper`, donc le contraste avec un accent clair y est plus faible.
    C'est le fond le plus exigeant des deux, et c'était le seul non couvert.
  */
  ['--stamp', '--paper-raised', 'un titre de section, au départ du dégradé'],
  ['--mark', '--paper-raised', 'le même titre, à son arrivée'],
]

describe.each([
  ['clair', ':root {'],
  ['sombre', ":root[data-theme='dark'] {"],
])('la palette en thème %s', (nom, selecteur) => {
  const jetons = jetonsDe(selecteur)

  it('déclare toutes les couleurs que l’interface compose', () => {
    // Un jeton absent d'un thème est le pire des cas : la couleur du thème
    // précédent reste en place, et l'on obtient une encre claire sur un fond
    // clair, sans qu'aucune règle n'échoue.
    for (const [premier, second] of PAIRES) {
      expect(jetons.has(premier), `${premier} manque en thème ${nom}`).toBe(true)
      expect(jetons.has(second), `${second} manque en thème ${nom}`).toBe(true)
    }
  })

  it.each(PAIRES)('%s sur %s — %s', (devant, derriere, role) => {
    const a = jetons.get(devant)
    const b = jetons.get(derriere)
    if (!a || !b) throw new Error(`jeton manquant : ${devant} ou ${derriere}`)

    const rapport = contraste(a, b)
    expect(
      rapport,
      `${role} : ${a} sur ${b} ne donne que ${rapport.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA)
  })
})

describe('le dégradé', () => {
  it('ne va QUE du rose au cuivre, jamais vers une teinte tierce', () => {
    /**
     * Le dégradé est défini une fois, à partir des deux jetons d'accent. Y
     * écrire une couleur littérale la ferait échapper au thème sombre : le
     * bouton garderait ses teintes claires sur fond sombre, et son libellé
     * deviendrait illisible.
     */
    const bloc = CSS.slice(
      CSS.indexOf('--gradient-accent:'),
      CSS.indexOf('--gradient-hairline:'),
    )

    expect(bloc).toContain('var(--stamp)')
    expect(bloc).toContain('var(--mark)')
    expect(bloc).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('a un repli d’encre pleine sous lui', () => {
    // `background-image` peut ne pas peindre — impression, contraste élevé,
    // navigateur ancien. Sans couleur de fond dessous, le bouton principal
    // deviendrait du texte blanc sur du blanc.
    const bloc = CSS.slice(
      CSS.indexOf('.gradient-accent {'),
      CSS.indexOf('.text-gradient {'),
    )
    expect(bloc).toContain('background-color: var(--stamp)')
  })
})

describe('les lavis', () => {
  it('restent dilués dans le fond de fiche', () => {
    /**
     * Le lavis habille les cadres SANS PHOTOGRAPHIE, qui sont aujourd'hui la
     * majorité du catalogue. S'il cessait d'être mélangé au fond pour devenir
     * un accent plein, les pièces sans visuel ressortiraient plus que celles
     * qui en ont un — exactement l'inverse de ce qu'on veut d'une boutique.
     *
     * La dilution se lit dans la présence de `--paper-raised` comme base du
     * mélange : c'est elle qui distingue un lavis d'un aplat.
     */
    const bloc = CSS.slice(
      CSS.indexOf('--gradient-wash:'),
      CSS.indexOf('--fs-xs:'),
    )

    expect(bloc).toContain('var(--stamp)')
    expect(bloc).toContain('var(--mark)')
    expect(bloc).toContain('var(--paper-raised)')
    // Comme pour le dégradé plein : une couleur littérale échapperait au
    // thème sombre et laisserait un cadre clair au milieu d'une page sombre.
    expect(bloc).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('a un repli sous lui', () => {
    const bloc = CSS.slice(
      CSS.indexOf('.wash-accent {'),
      CSS.indexOf('.wash-page {'),
    )
    expect(bloc).toContain('background-color: var(--sand)')
  })
})

describe('la barre flottante', () => {
  it('n’est translucide que si le flou l’accompagne', () => {
    /**
     * Ce que ce test empêche, précisément.
     *
     * La barre reste à l'écran pendant tout le défilement. Translucide SANS
     * flou, elle laisse passer le contenu de la page en clair : au moment où
     * une photographie sombre glisse dessous, « Catalogue » et « Panier »
     * deviennent illisibles — puis redeviennent lisibles, sans que rien
     * n'échoue et sans qu'aucune capture d'écran ne le montre.
     *
     * La règle de base doit donc rester OPAQUE, et la transparence vivre
     * uniquement dans la requête de fonctionnalité. Déplacer la ligne d'un
     * bloc à l'autre est une modification d'une seconde ; ce test est ce qui
     * la rattrape.
     */
    const debut = CSS.indexOf('.nav-float {')
    expect(debut, '.nav-float introuvable').toBeGreaterThan(-1)

    // Le bloc de BASE seulement : jusqu'à sa propre accolade fermante, donc
    // sans la requête de fonctionnalité qui le suit — c'est justement ce
    // qu'on veut séparer.
    const declaration = CSS.slice(debut, CSS.indexOf('}', debut))

    // On lit LE fond, pas le bloc entier : le filet et l'ombre de la barre
    // sont eux-mêmes translucides, et c'est normal — chercher le mot
    // « transparent » n'importe où ferait échouer le test sur des règles qui
    // n'ont rien à voir avec la lisibilité des libellés.
    const fond = /background-color:\s*([^;]+);/.exec(declaration)?.[1]

    expect(
      fond,
      'le fond de base de la barre doit être une couleur pleine',
    ).toBe('var(--paper-raised)')
  })
})
