import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

/**
 * La toile de denim ne peut pas manger le texte qu'on pose dessus.
 *
 * ---------------------------------------------------------------------------
 * Le trou que ce fichier bouche
 * ---------------------------------------------------------------------------
 * `tests/domain/palette.test.ts` vérifie les contrastes de la palette, et il
 * le fait bien — mais il compare des JETONS, c'est-à-dire des couleurs plates.
 * Or le fond de ce site n'est pas une couleur plate : c'est une image tissée.
 *
 * Ce fond a été mesuré sur la page réelle, en effaçant l'encre et en relisant
 * les pixels sous chaque bloc de texte. Le résultat, sur la première version :
 *
 *     titre d'accueil, blanc, 64 px    médiane 6,68:1   p90 2,66:1
 *     liens de la barre, 16 px         médiane 6,96:1   p90 2,31:1
 *     mentions du colophon, 11 px      médiane 5,60:1   p90 1,87:1
 *
 * Les MOYENNES passaient toutes. Le test de palette était vert, la page était
 * en ligne, et un pixel sur dix derrière chaque lettre était presque aussi
 * clair que la lettre — certains étaient littéralement blancs. C'est le défaut
 * type de cette famille : un garde-fou qui mesure la bonne grandeur au mauvais
 * endroit.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce test DÉCODE l'image
 * ---------------------------------------------------------------------------
 * Le tissage garantit son plafond au moment où il génère l'image. Vérifier
 * cette garantie en relisant la constante ne prouverait rien : c'est
 * exactement le raisonnement circulaire qu'on veut éviter — le script se
 * porterait garant de lui-même.
 *
 * On décode donc `public/toile-denim.webp`, le fichier RÉELLEMENT SERVI, et
 * on relit ses pixels un par un. Ce test échoue si quelqu'un modifie le
 * tissage sans relancer le script, s'il relance le script après avoir desserré
 * une borne, ou si quelqu'un remplace l'image à la main par une photographie
 * trouvée ailleurs.
 */

const TOILE_WEBP = join(process.cwd(), 'public/toile-denim.webp')

/**
 * Les réglages du tissage, LUS dans la source du script qui les applique.
 *
 * On ne les importe pas, et pour une raison très concrète : le script est un
 * script. Son code de haut niveau lance un navigateur et réécrit l'image dans
 * `public/`. L'importer depuis un test ferait donc démarrer Chromium et
 * remplacerait le fichier qu'on est en train de vérifier — le test
 * reconstruirait sa propre preuve.
 *
 * On ne les recopie pas non plus : une constante recopiée reste vraie
 * longtemps après que quelqu'un a changé l'originale. C'est la même règle que
 * suit `tests/domain/palette.test.ts` en relisant `globals.css` plutôt qu'un
 * tableau de couleurs — dans les deux cas, le test lit L'ARTEFACT.
 */
const SOURCE_TISSAGE = readFileSync(
  join(process.cwd(), 'scripts/tisser-denim.mjs'),
  'utf8',
)

function reglage(nom: string, motif: RegExp): number {
  const trouve = motif.exec(SOURCE_TISSAGE)?.[1]
  expect(
    trouve,
    `« ${nom} » introuvable dans scripts/tisser-denim.mjs — le test lit la ` +
      'source du script, il faut donc mettre ce motif à jour si elle change',
  ).toBeTruthy()
  return Number(trouve)
}

const PLAFOND_LUMINANCE = reglage(
  'PLAFOND_LUMINANCE',
  /export const PLAFOND_LUMINANCE\s*=\s*([\d.]+)/,
)

const TAILLE_TUILE = reglage('taille', /taille:\s*(\d+)/)

/** Luminance relative, telle que la définissent les WCAG. */
function luminance(r: number, g: number, b: number): number {
  const canal = (octet: number) => {
    const v = octet / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** Rapport de contraste entre deux luminances relatives. */
function contraste(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * Les encres claires que la page pose DIRECTEMENT sur la toile.
 *
 * `--muted` est décliné deux fois parce que la toile, elle, ne l'est pas : la
 * même image opaque est peinte dans les deux thèmes, alors que l'encre
 * secondaire change. Le thème sombre est le cas serré, et c'est précisément
 * celui qu'un contrôle distrait oublierait.
 */
const ENCRES: ReadonlyArray<readonly [string, [number, number, number], number]> = [
  ['--ink (blanc), le titre et le texte courant', [255, 255, 255], 4.5],
  ['--muted du thème clair, #d3e0ee', [211, 224, 238], 4.5],
  ['--muted du thème sombre, #c3d3e4', [195, 211, 228], 4.5],
]

describe('la toile de denim', () => {
  const image = sharp(readFileSync(TOILE_WEBP))

  it('est bien la tuile carrée que le script annonce', async () => {
    const { width, height } = await image.metadata()
    expect(width).toBe(TAILLE_TUILE)
    expect(height).toBe(TAILLE_TUILE)
  })

  describe('son pixel le plus clair', () => {
    it('reste sous le plafond de luminance', async () => {
      const { data, info } = await sharp(readFileSync(TOILE_WEBP))
        .raw()
        .toBuffer({ resolveWithObject: true })

      let max = 0
      for (let i = 0; i < data.length; i += info.channels) {
        const L = luminance(data[i] as number, data[i + 1] as number, data[i + 2] as number)
        if (L > max) max = L
      }

      // La tolérance couvre le seul écart légitime : la compression WebP est
      // avec perte, et peut rendre un pixel très légèrement plus clair que
      // celui qui a été écrit. Elle est trop étroite pour laisser passer un
      // desserrage du plafond, qui se compterait en centièmes.
      expect(
        max,
        `le pixel le plus clair de la toile atteint ${max.toFixed(4)}, ` +
          `pour un plafond de ${PLAFOND_LUMINANCE} — ` +
          'relancer `node scripts/tisser-denim.mjs`',
      ).toBeLessThanOrEqual(PLAFOND_LUMINANCE + 0.004)
    })

    it.each(ENCRES)(
      'garde %s au-dessus du seuil AA',
      async (_role, rgb, seuil) => {
        const { data, info } = await sharp(readFileSync(TOILE_WEBP))
          .raw()
          .toBuffer({ resolveWithObject: true })

        let max = 0
        for (let i = 0; i < data.length; i += info.channels) {
          const L = luminance(data[i] as number, data[i + 1] as number, data[i + 2] as number)
          if (L > max) max = L
        }

        const rapport = contraste(luminance(...rgb), max)
        expect(
          rapport,
          `sur le pixel le plus clair de la toile, cette encre ne rend que ${rapport.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(seuil)
      },
    )
  })

  it('garde une moyenne fidèle au jeton `--paper`', async () => {
    /**
     * `--paper` est la couleur servie AVANT que l'image ne charge, à
     * l'impression, et sur un moteur qui refuse le WebP. Si elle s'écarte de
     * la toile, la page change de couleur au chargement — et, dans le pire
     * cas, du texte blanc se retrouve un instant sur un fond trop clair.
     *
     * Le jeton est lu dans la feuille de style, jamais recopié ici : une
     * constante recopiée resterait vraie longtemps après que quelqu'un a
     * changé l'une des deux valeurs.
     */
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    // Depuis `:root {` et non depuis le début du fichier : la déclaration doit
    // être celle du thème CLAIR. Et on ne borne pas la tranche sur
    // `--paper-raised`, qui apparaît d'abord dans le commentaire d'en-tête du
    // bloc — la tranche s'arrêtait alors AVANT la déclaration cherchée.
    const bloc = css.slice(css.indexOf(':root {'))
    const jeton = /--paper:\s*#([0-9a-fA-F]{6})/.exec(bloc)?.[1]
    expect(jeton, '`--paper` introuvable dans le bloc `:root`').toBeTruthy()

    const attendu = [0, 2, 4].map((i) => parseInt((jeton as string).slice(i, i + 2), 16))
    const { channels } = await sharp(readFileSync(TOILE_WEBP)).stats()

    for (const [i, canal] of channels.slice(0, 3).entries()) {
      // Trois niveaux sur 255 : de quoi absorber l'arrondi de la moyenne et la
      // compression, pas de quoi laisser passer un délavage oublié.
      expect(
        Math.round(canal.mean),
        `le canal ${'RVB'[i]} de la toile vaut ${Math.round(canal.mean)}, ` +
          `le jeton --paper annonce ${attendu[i]} — ` +
          'reporter la moyenne imprimée par `node scripts/tisser-denim.mjs`',
      ).toBeCloseTo(attendu[i] as number, -0.5)
    }
  })
})
