import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

/**
 * Tisse la toile de denim du site, fil par fil, et l'écrit dans `public/`.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une IMAGE et pas des dégradés CSS
 * ---------------------------------------------------------------------------
 * Le fond du site est du denim, et un denim se reconnaît à son tissage : une
 * armure sergé 3/1 — le fil de chaîne indigo passe sur trois fils de trame
 * écrus puis sous un, d'où la diagonale — avec des fils irréguliers et une
 * teinture inégale. Des `repeating-linear-gradient` donnent des rayures
 * régulières ; ils ne donnent jamais du tissu. Cela a été essayé, montré, et
 * refusé à juste titre.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un SCRIPT et pas un fichier déposé à la main
 * ---------------------------------------------------------------------------
 * Parce que la toile est un RÉGLAGE, pas un actif figé. Changer le délavage,
 * c'est changer deux valeurs ici et relancer — pas rouvrir un éditeur d'images
 * et espérer retrouver les mêmes paramètres. Le fichier produit est commité :
 * le site ne dépend pas de ce script pour se construire, seulement pour être
 * modifié.
 *
 *     node scripts/tisser-denim.mjs
 *
 * ---------------------------------------------------------------------------
 * La tuile boucle
 * ---------------------------------------------------------------------------
 * Le motif du sergé et les deux bruits de teinture sont périodiques sur la
 * largeur de la tuile : l'image se répète donc sans raccord visible. Une tuile
 * qui ne boucle pas donne une grille de coutures sur toute la page, et c'est
 * le genre de défaut qu'on ne voit qu'une fois en ligne.
 */

/** Le délavage retenu : le « brut », le plus foncé des trois proposés. */
export const TOILE = {
  chaine: '#223f63', // le fil indigo, celui qu'on voit
  trame: '#93a9c2', // le fil écru, qui n'affleure qu'au passage du sergé
  taille: 512,
}

const tissage = `
(taille, chaineHex, trameHex) => {
  const c = document.createElement('canvas')
  c.width = taille; c.height = taille
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(taille, taille)
  const d = img.data

  const hex = (h) => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16))
  const chaine = hex(chaineHex)
  const trame = hex(trameHex)

  // Bruit de valeur BOUCLANT : c'est ce qui permet à la tuile de se répéter
  // sans que le raccord se voie.
  const grille = 64
  const alea = []
  for (let i = 0; i < grille * grille; i++) alea.push(Math.random())
  const bruit = (x, y, echelle) => {
    const fx = (x / taille) * echelle, fy = (y / taille) * echelle
    const x0 = Math.floor(fx) % echelle, y0 = Math.floor(fy) % echelle
    const x1 = (x0 + 1) % echelle, y1 = (y0 + 1) % echelle
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy)
    const l = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t))
    const g = (a, b) => alea[(a % grille) * grille + (b % grille)]
    return l(l(g(x0,y0), g(x1,y0), tx), l(g(x0,y1), g(x1,y1), tx), ty)
  }

  // Chaque fil a sa propre valeur : c'est ce moucheté qui fait le denim.
  const filChaine = [], filTrame = []
  for (let i = 0; i < taille; i++) {
    filChaine.push(0.78 + Math.random() * 0.44)
    filTrame.push(0.80 + Math.random() * 0.40)
  }

  const EPAISSEUR = 2   // épaisseur d'un fil, en pixels
  const RAPPORT = 4     // sergé 3/1 : trois dessus, un dessous

  let somme = [0, 0, 0]

  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const cx = Math.floor(x / EPAISSEUR)
      const cy = Math.floor(y / EPAISSEUR)
      const dessus = ((cx - cy) % RAPPORT + RAPPORT) % RAPPORT !== 0

      const base = dessus ? chaine : trame
      let facteur = dessus ? filChaine[cx % taille] : filTrame[cy % taille]

      // Le relief du fil : ses bords sont plus sombres que son sommet.
      const bordX = (x % EPAISSEUR) / EPAISSEUR
      const bordY = (y % EPAISSEUR) / EPAISSEUR
      facteur *= dessus
        ? 0.86 + 0.28 * Math.sin(Math.PI * bordY)
        : 0.86 + 0.28 * Math.sin(Math.PI * bordX)

      // Teinture inégale, deux fréquences.
      facteur *= 0.80 + 0.40 * bruit(x, y, 6)
      facteur *= 0.92 + 0.16 * bruit(x, y, 24)

      // Quelques fibres claires qui remontent à la surface.
      if (Math.random() < 0.010) facteur *= 1.55

      const i = (y * taille + x) * 4
      const r = Math.max(0, Math.min(255, base[0] * facteur))
      const g = Math.max(0, Math.min(255, base[1] * facteur))
      const b = Math.max(0, Math.min(255, base[2] * facteur))
      d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255
      somme[0] += r; somme[1] += g; somme[2] += b
    }
  }

  ctx.putImageData(img, 0, 0)
  const n = taille * taille
  const moyenne = somme.map((v) => Math.round(v / n))
  return {
    webp: c.toDataURL('image/webp', 0.92),
    moyenne: '#' + moyenne.map((v) => v.toString(16).padStart(2, '0')).join(''),
  }
}
`

const navigateur = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
})
const page = await navigateur.newPage()
await page.goto('about:blank')

const { webp, moyenne } = await page.evaluate(
  ({ src, taille, chaine, trame }) =>
    new Function('return (' + src + ')')()(taille, chaine, trame),
  { src: tissage, taille: TOILE.taille, chaine: TOILE.chaine, trame: TOILE.trame },
)

const octets = Buffer.from(webp.split(',')[1], 'base64')
writeFileSync('public/toile-denim.webp', octets)

await navigateur.close()

console.log(`public/toile-denim.webp — ${(octets.length / 1024).toFixed(1)} kio`)
console.log(`couleur moyenne de la toile : ${moyenne}`)
console.log('→ reporter cette moyenne dans `--paper` (app/globals.css) :')
console.log('  c’est la couleur servie AVANT que l’image ne charge, et celle')
console.log('  que voient les navigateurs qui refusent le WebP.')
