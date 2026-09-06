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
 *
 * ===========================================================================
 * LE BUDGET DE LUMIÈRE EST ASYMÉTRIQUE, ET C'EST LA CLÉ DE CE FICHIER
 * ===========================================================================
 * La première version de cette toile a été mesurée sur la page réelle, en
 * effaçant l'encre et en lisant les pixels du fond sous chaque bloc de texte.
 * Le verdict :
 *
 *     titre d'accueil, blanc, 64 px    médiane 6,68:1   p90 2,66:1
 *     liens de la barre, 16 px         médiane 6,96:1   p90 2,31:1
 *     mentions du colophon, 11 px      médiane 5,60:1   p90 1,87:1
 *
 * La MOYENNE était bonne partout — c'est pour cela qu'aucun contrôle de
 * palette ne l'avait vue : un test qui compare deux jetons compare deux
 * couleurs plates, et la toile n'est pas plate. Mais un pixel sur dix derrière
 * chaque lettre était presque aussi clair que la lettre, et quelques-uns
 * étaient littéralement BLANCS. Le tissage mangeait les caractères.
 *
 * D'où venaient ces pixels blancs : six modulations multiplicatives, toutes
 * centrées sur 1, appliquées l'une après l'autre. Prises une par une elles
 * étaient discrètes ; multipliées, leur queue montait à 2,75× et saturait à
 * 255 sur les trois canaux.
 *
 * La règle qui gouverne désormais chaque valeur ci-dessous :
 *
 *     ASSOMBRIR UN FOND NE NUIT JAMAIS À UN TEXTE CLAIR ; L'ÉCLAIRCIR PEUT
 *     TOUJOURS LUI NUIRE.
 *
 * Le bruit qui assombrit est donc généreux, celui qui éclaircit est rationné,
 * et un PLAFOND ferme la queue de distribution. Le tissu ne perd rien : le
 * relief d'un tissu se lit dans ses creux, pas dans ses éclats.
 */

/**
 * Le délavage retenu : le « brut », le plus foncé des trois proposés.
 *
 * `trame` a été franchement assombri, et ce n'est pas une concession au
 * contraste — c'est une CORRECTION TEXTILE. Le denim est une étoffe
 * chaîne-face : l'endroit est presque tout indigo, et le fil de trame écru est
 * l'ENVERS du tissu. Sur l'endroit il n'affleure qu'au décroché du sergé, et
 * là il se trouve EN CONTREBAS, dans le creux entre deux fils de chaîne, donc
 * à l'ombre. L'ancienne valeur (#93a9c2, sans ombre de creux) revenait à poser
 * l'envers du jean sur son endroit.
 */
export const TOILE = {
  chaine: '#395176', // le fil indigo, celui qu'on voit
  trame: '#61799c', // le fil écru, qui n'affleure qu'au décroché du sergé
  taille: 512,
}

/**
 * Luminance relative maximale tolérée pour un pixel de la toile.
 *
 * Ce nombre n'est pas choisi à l'œil, il est DÉDUIT du plus petit texte clair
 * que la page pose sur la toile : les mentions du colophon, 11 px, en
 * `--muted`. Le seuil AA d'un texte de cette taille est 4,5:1, et la formule
 * WCAG donne le fond le plus clair admissible.
 *
 * Le `--muted` retenu est celui du THÈME SOMBRE, #c3d3e4, de luminance
 * relative 0,6381 — et ce choix est le point important. La toile est une
 * IMAGE OPAQUE : elle est peinte à l'identique dans les deux thèmes, alors
 * que l'encre secondaire, elle, change. Déduire le plafond du `--muted` clair
 * (#d3e0ee) aurait donné 0,1241 et laissé le thème sombre à 4,44:1 — sous le
 * seuil, sans que rien ne le signale, parce qu'aucun test de palette ne
 * compare une couleur à une image. On prend donc le plus exigeant des deux :
 *
 *     (0,6381 + 0,05) / 4,5 − 0,05 = 0,1029
 *
 * On s'arrête à 0,096 plutôt qu'à 0,1029 parce que la toile n'est pas la
 * dernière couche : `--gradient-page` passe par-dessus, et ce lavis ÉCLAIRCIT
 * (les accents sont clairs sur fond sombre). La marge lui est réservée.
 *
 * Vérifié pour de bon par `tests/domain/toile.test.ts`, qui décode l'image
 * livrée et relit ses pixels — pas cette constante.
 */
export const PLAFOND_LUMINANCE = 0.096

const tissage = `
(taille, chaineHex, trameHex, plafond) => {
  const c = document.createElement('canvas')
  c.width = taille; c.height = taille
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(taille, taille)
  const d = img.data

  const hex = (h) => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16))
  const chaine = hex(chaineHex)
  const trame = hex(trameHex)

  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const luminance = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

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
  // C'est la variation la plus GÉNÉREUSE du fichier, et elle peut l'être :
  // un fil fait deux pixels de large, soit moins d'un pixel et demi à
  // l'écran. À cette finesse le moucheté se lit comme de la matière, jamais
  // comme une tache derrière une lettre.
  const filChaine = [], filTrame = []
  for (let i = 0; i < taille; i++) {
    filChaine.push(0.86 + Math.random() * 0.22)   // [0,86 ; 1,08]
    filTrame.push(0.87 + Math.random() * 0.20)    // [0,87 ; 1,07]
  }

  const EPAISSEUR = 2   // épaisseur d'un fil, en pixels
  const RAPPORT = 4     // sergé 3/1 : trois dessus, un dessous

  // Le flotté de trame est EN CONTREBAS du plan des fils de chaîne : sur
  // l'endroit d'une étoffe chaîne-face, il est à l'ombre de ses deux voisins.
  // Sans ce facteur, le décroché du sergé devient une rayure claire — et c'est
  // exactement ce qui allumait la diagonale sous le texte.
  const CREUX = 0.80

  // Le genou de l'épaule : en dessous, aucune retouche. Il est posé au-dessus
  // de la luminance moyenne de la toile, pour que la compression ne morde que
  // sur les hautes lumières et laisse le corps du tissu intact.
  const GENOU = plafond * 0.70

  let somme = [0, 0, 0]
  let maxL = 0
  let rabotes = 0

  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const cx = Math.floor(x / EPAISSEUR)
      const cy = Math.floor(y / EPAISSEUR)
      const dessus = ((cx - cy) % RAPPORT + RAPPORT) % RAPPORT !== 0

      const base = dessus ? chaine : trame
      let facteur = dessus ? filChaine[cx % taille] : filTrame[cy % taille]

      if (!dessus) facteur *= CREUX

      // LA DIAGONALE EST DESSINÉE PAR L'OMBRE, PAS PAR L'ÉCLAT.
      //
      // Comprimer les hautes lumières a effacé le sergé : le décroché ne se
      // lisait plus que par un fil de trame un peu plus clair, et l'épaule
      // venait précisément resserrer cet écart. Or l'armure n'a pas besoin
      // d'être éclaircie pour se voir — sur une vraie toile, le flotté de
      // trame projette une ombre sur le fil de chaîne qui le suit, et c'est
      // ce COUPLE clair-sombre qui trace la diagonale.
      //
      // Assombrir est gratuit : cela ne peut qu'améliorer un texte clair. La
      // diagonale revient donc, et le plafond n'a rien à en dire.
      const rang = ((cx - cy) % RAPPORT + RAPPORT) % RAPPORT
      if (rang === 1) facteur *= 0.90

      // Le relief du fil : ses bords sont plus sombres que son sommet.
      const bordX = (x % EPAISSEUR) / EPAISSEUR
      const bordY = (y % EPAISSEUR) / EPAISSEUR
      facteur *= dessus
        ? 0.87 + 0.19 * Math.sin(Math.PI * bordY)   // [0,87 ; 1,06]
        : 0.87 + 0.19 * Math.sin(Math.PI * bordX)

      // Teinture inégale, deux fréquences — et c'est ici que se jouait le
      // MOUCHETAGE DU TITRE, plus encore que dans le pixel le plus clair.
      //
      // La basse fréquence dessine des taches d'environ 85 px dans la tuile,
      // soit 57 px à l'écran : la taille d'une lettre du titre d'accueil. Une
      // variation de fond À L'ÉCHELLE DES LETTRES est le pire cas possible —
      // l'œil ne peut plus séparer le caractère de la toile, et la ligne se
      // met à onduler. Son amplitude était de ±20 % ; elle tombe à ±5,5 %.
      //
      // La règle : la macro-variation d'un fond doit être BEAUCOUP plus large
      // qu'une lettre, ou BEAUCOUP plus fine. Jamais de sa taille.
      facteur *= 0.90 + 0.11 * bruit(x, y, 6)      // [0,90 ; 1,01]
      facteur *= 0.93 + 0.10 * bruit(x, y, 24)     // [0,93 ; 1,03]

      // Quelques fibres claires qui remontent à la surface. Le coup de pouce
      // était de 1,55 — assez, cumulé au reste, pour saturer les trois canaux
      // et produire des pixels blancs. À 1,16 il reste visible, et le plafond
      // ci-dessous rabat celles qui dépasseraient encore.
      if (Math.random() < 0.010) facteur *= 1.16

      let r = Math.max(0, Math.min(255, base[0] * facteur))
      let g = Math.max(0, Math.min(255, base[1] * facteur))
      let b = Math.max(0, Math.min(255, base[2] * facteur))

      // L'ÉPAULE. Les hautes lumières sont ramenées sous le plafond, mais
      // JAMAIS par un écrêtage.
      //
      // Deux raisons, et les deux ont été constatées :
      //
      //  — écrêter canal par canal rapproche la couleur du BLANC, c'est-à-dire
      //    exactement de la teinte dont on cherche à s'éloigner. On rabat donc
      //    le triplet entier d'un même facteur : la teinte est préservée, le
      //    pixel ne fait que s'assombrir.
      //
      //  — un plafond FRANC empile tous les pixels dépassants sur une seule
      //    valeur. Avec 6,7 % de la toile dans ce cas, le décroché du sergé
      //    devenait une diagonale d'un ton parfaitement uniforme : une rayure
      //    dessinée, plus un tissage. La compression est donc PROGRESSIVE, à
      //    la manière de l'épaule d'une émulsion — au-dessus du genou, les
      //    écarts se resserrent sans jamais se confondre, et l'ordre des
      //    valeurs est conservé. Le relief survit, comprimé au lieu d'être
      //    rasé.
      let L = luminance(r, g, b)
      if (L > GENOU) {
        const cible =
          GENOU + (plafond - GENOU) * (1 - Math.exp(-(L - GENOU) / (plafond - GENOU)))
        // Le facteur d'échelle est approché (la luminance n'est pas une
        // puissance exacte du triplet) : deux itérations suffisent à le poser
        // au millième.
        for (let k = 0; k < 2; k++) {
          const q = Math.pow(cible / L, 1 / 2.4)
          r *= q; g *= q; b *= q
          L = luminance(r, g, b)
        }
        rabotes++
      }
      // Le filet de sécurité. L'épaule tend vers le plafond sans l'atteindre,
      // mais le facteur d'échelle appliqué au triplet reste approché : à
      // quelques millièmes près, un pixel pourrait le franchir. L'épaule
      // FAÇONNE, ce filet GARANTIT — et c'est lui que le test vérifie.
      //
      // Le nombre de passes est BORNÉ, et pas par prudence de principe : visé
      // pile sur le plafond, le facteur d'échelle vaut (1 − ε)^(1/2,4), qui
      // s'arrondit à 1,0 en flottant. Le pixel ne bouge plus, la condition
      // reste vraie, et la boucle tourne indéfiniment — c'est arrivé. On vise
      // donc légèrement SOUS le plafond, ce qui fait strictement décroître la
      // luminance à chaque passe.
      for (let k = 0; k < 8 && L > plafond; k++) {
        const q = Math.pow((plafond * 0.999) / L, 1 / 2.4)
        r *= q; g *= q; b *= q
        L = luminance(r, g, b)
      }
      if (L > maxL) maxL = L

      const i = (y * taille + x) * 4
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
    maxL,
    moyenneL: luminance(moyenne[0], moyenne[1], moyenne[2]),
    partRabotee: rabotes / n,
  }
}
`

/**
 * Tisse, encode, DÉCODE, et recommence tant que le fichier livré dépasse.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il ne suffit pas de plafonner le canevas
 * ---------------------------------------------------------------------------
 * Le tissage garantit son plafond sur les pixels qu'il ÉCRIT. Mais ce n'est
 * pas ce qui est servi : ce qui est servi, c'est le WebP, et le WebP est un
 * codec AVEC PERTE. Sur une matière aussi finement bruitée qu'un tissage, il
 * produit du rebond aux transitions — et ce rebond fabrique des pixels plus
 * clairs que tous ceux qu'on lui a donnés.
 *
 * Mesuré : un canevas plafonné à 0,096 ressortait du fichier à 0,110. Soit
 * quinze pour cent au-dessus, c'est-à-dire assez pour faire retomber le
 * `--muted` du thème sombre à 4,29:1 — sous le seuil. La garantie portait sur
 * le bon nombre, mais sur le mauvais objet.
 *
 * On boucle donc sur ce qui est RÉELLEMENT LIVRÉ : on encode, on redécode le
 * fichier produit, on mesure ses pixels, et on resserre la consigne interne
 * jusqu'à ce que le fichier lui-même respecte le plafond. C'est plus lent de
 * quelques secondes, et c'est la seule version de ce contrôle qui prouve
 * quelque chose.
 */
const orchestration = `
async (tissageSrc, taille, chaine, trame, plafond) => {
  const tisser = new Function('return (' + tissageSrc + ')')()

  // Mesure le pixel le plus clair d'une image WebP réellement encodée, en la
  // redécodant : c'est le seul moyen de voir ce que la compression a ajouté.
  const relire = async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    let max = 0
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i+1]) + 0.0722 * lin(d[i+2])
      if (L > max) max = L
    }
    return max
  }

  let consigne = plafond
  let resultat = null
  let livre = 0
  const passes = []

  for (let k = 0; k < 8; k++) {
    resultat = tisser(taille, chaine, trame, consigne)
    livre = await relire(resultat.webp)
    passes.push({ consigne, livre })
    if (livre <= plafond) break
    // On resserre proportionnellement à l'excès constaté, avec une petite
    // marge : viser pile le plafond ferait osciller autour sans jamais passer.
    consigne *= (plafond / livre) * 0.985
  }

  return { ...resultat, consigne, livre, passes }
}
`

const navigateur = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
})
const page = await navigateur.newPage()
await page.goto('about:blank')

const { webp, moyenne, maxL, moyenneL, partRabotee, consigne, livre, passes } =
  await page.evaluate(
    ({ chef, src, taille, chaine, trame, plafond }) =>
      new Function('return (' + chef + ')')()(src, taille, chaine, trame, plafond),
    {
      chef: orchestration,
      src: tissage,
      taille: TOILE.taille,
      chaine: TOILE.chaine,
      trame: TOILE.trame,
      plafond: PLAFOND_LUMINANCE,
    },
  )

const octets = Buffer.from(webp.split(',')[1], 'base64')
writeFileSync('public/toile-denim.webp', octets)

await navigateur.close()

/** Rapport de contraste WCAG entre deux luminances relatives. */
const rapport = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const BLANC = 1
const MUTED_CLAIR = 0.7334 // --muted, thème clair, #d3e0ee
const MUTED_SOMBRE = 0.6381 // --muted, thème sombre, #c3d3e4 — le plus exigeant

console.log(`public/toile-denim.webp — ${(octets.length / 1024).toFixed(1)} kio`)
console.log(`couleur moyenne de la toile : ${moyenne}`)
console.log('→ reporter cette moyenne dans `--paper` (app/globals.css) :')
console.log('  c’est la couleur servie AVANT que l’image ne charge, et celle')
console.log('  que voient les navigateurs qui refusent le WebP.')
console.log('')
console.log('Budget de lumière — ce qui décide de la lisibilité du texte clair :')
console.log(`  luminance moyenne          ${moyenneL.toFixed(4)}`)
console.log(`  maximum sur le CANEVAS     ${maxL.toFixed(4)}`)
console.log(`  maximum DANS LE FICHIER    ${livre.toFixed(4)}  (plafond ${PLAFOND_LUMINANCE})`)
console.log(`  pixels passés par l’épaule ${(partRabotee * 100).toFixed(2)} %`)
console.log(`  consigne interne retenue   ${consigne.toFixed(4)} en ${passes.length} passe(s)`)
console.log('    — la consigne est PLUS BASSE que le plafond : le WebP est un codec')
console.log('      avec perte, et son rebond éclaircit des pixels du tissage.')

if (livre > PLAFOND_LUMINANCE) {
  console.error('')
  console.error(`ÉCHEC : le fichier livré atteint ${livre.toFixed(4)}, au-dessus du plafond.`)
  console.error('La boucle de resserrage n’a pas convergé — ne pas commiter cette image.')
  process.exitCode = 1
}
console.log('')
console.log('Contraste contre le PIXEL LE PLUS CLAIR de la toile — le seul qui compte,')
console.log('la moyenne n’ayant jamais été le problème :')
console.log(`  blanc  #ffffff            ${rapport(BLANC, maxL).toFixed(2)}:1  (seuil 4,5 — texte courant)`)
console.log(`  --muted clair  #d3e0ee    ${rapport(MUTED_CLAIR, maxL).toFixed(2)}:1  (seuil 4,5 — mentions du colophon)`)
console.log(`  --muted sombre #c3d3e4    ${rapport(MUTED_SOMBRE, maxL).toFixed(2)}:1  (seuil 4,5 — le cas le plus serré)`)
