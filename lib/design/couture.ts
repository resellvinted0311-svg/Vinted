/**
 * Une surpiqûre de jean, dessinée comme du FIL et non comme un trait.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas `border: dashed`
 * ---------------------------------------------------------------------------
 * Parce qu'un pointillé CSS est parfaitement régulier : tous les tirets ont la
 * même longueur, tombent exactement sur la ligne, et l'œil lit une bordure —
 * pas une couture. Trois choses le trahissent, et il faut les trois :
 *
 *  1. LE SILLON. Une couture creuse la toile sur toute sa longueur, y compris
 *     ENTRE deux points. C'est ce pli continu qui dit « deux épaisseurs sont
 *     assemblées ici ». Sans lui, il ne reste que des marques côte à côte.
 *
 *  2. LE VOLUME. Un fil est un cylindre : chaque point reçoit un dégradé dans
 *     sa section — clair au quart supérieur, à peine éteint en bas. La double
 *     inflexion donne le coton mat ; un simple clair-vers-sombre donne du
 *     métal, et trois aplats empilés donnent la perle de plastique.
 *
 *     Les quatre arrêts restent tous CLAIRS, et c'est un réglage, pas un
 *     hasard : un bas de cylindre trop soutenu grise le fil, et sur une
 *     couture blanche cela se voit avant tout le reste.
 *
 *  3. LE GALBE. Le fil sort d'un trou, court à plat, rentre dans un autre : il
 *     est pincé aux deux bouts et renflé au milieu. On remplit donc une forme
 *     fuselée au lieu de tracer un segment.
 *
 * ---------------------------------------------------------------------------
 * L'irrégularité qui compte est celle de la LIGNE
 * ---------------------------------------------------------------------------
 * Ajouter du hasard point par point ne suffit pas : tant que la piqûre reste
 * mécaniquement parallèle au bord, elle paraît dessinée. Une vraie couture
 * DÉRIVE — elle s'approche du bord, s'en éloigne, sur de longues ondulations
 * lentes. C'est le premier réglage à regarder si le résultat semble trop sage.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce module est PUR
 * ---------------------------------------------------------------------------
 * Il ne rend rien : il renvoie du balisage SVG à partir de dimensions. C'est ce
 * qui permet de le régénérer à la largeur RÉELLE de la barre au lieu d'étirer
 * un SVG fabriqué pour une autre taille — un étirement allonge les points d'un
 * côté, écrase les arrondis, et ruine tout le travail ci-dessus.
 *
 * Le hasard est SEMÉ : à dimensions égales, la même couture. Sans quoi le
 * rendu serveur et le rendu navigateur différeraient, et React refuserait
 * l'hydratation.
 */

/**
 * Les teintes d'une couture, selon la toile qu'elle traverse.
 *
 * Une surpiqûre ne se lit pas de la même façon sur de l'indigo et sur un
 * panneau clair. Sur l'indigo, c'est le FIL qui porte le dessin : il est
 * beaucoup plus clair que le fond, et le pli ne fait que l'asseoir. Sur un
 * panneau clair, le fil blanc n'a presque plus d'écart avec la toile — il ne
 * reste que le RELIEF, c'est-à-dire le pli, les trous et l'ombre portée. C'est
 * exactement ce qui se passe sur un vêtement, où une couture ton sur ton se
 * voit très bien : on ne voit pas le fil, on voit ce que le fil creuse.
 *
 * D'où deux jeux de teintes, et pas un réglage d'opacité global : ce qui
 * change d'une toile à l'autre, ce n'est pas la force de l'effet, c'est
 * LEQUEL de ses trois éléments porte le dessin.
 */
interface Teintes {
  /** Le pli continu de la toile, sous toute la couture. */
  sillon: string
  /**
   * Largeur du pli, en multiples de l'épaisseur du fil.
   *
   * Elle dépend de l'ÉPAISSEUR DE LA TOILE, pas du fil. Deux épaisseurs de
   * denim se creusent largement ; un galon clair rapporté est mince, et son
   * pli l'est aussi. Le même 1,55 sur les deux donnait une large bavure grise
   * sous les points de la bande — le fil semblait poser sur une ombre au lieu
   * d'être enfoncé dans une étoffe.
   */
  sillonLargeur: number
  /** Le petit bourrelet qui borde le pli du côté éclairé. */
  rebord: string
  /** Le trou d'aiguille, creusé avant que le fil ne passe. */
  trou: string
  /** L'ombre que le fil projette sur la toile. */
  ombre: string
  /** Les quatre arrêts du dégradé de section du fil. */
  arrets: readonly [string, string, string, string]
}

const TEINTES: Record<'sombre' | 'clair', Teintes> = {
  // Sur l'indigo. Le fil blanc porte tout ; les ombres sont franches parce
  // qu'une toile sombre absorbe la lumière au lieu de la renvoyer.
  sombre: {
    sillon: 'rgba(0,0,0,.33)',
    sillonLargeur: 1.55,
    rebord: 'rgba(255,255,255,.085)',
    trou: 'rgba(0,0,0,.44)',
    ombre: 'rgba(0,0,0,.38)',
    arrets: ['#EDEFF2', '#FFFFFF', '#F1F4F7', '#D8E0E8'],
  },
  // Sur un panneau clair. Les ombres ne sont PAS noires : elles prennent la
  // teinte de l'encre profonde du site. Une ombre noire sur un bleu très pâle
  // ne fait pas du relief, elle fait de la suie — c'est le défaut classique
  // d'une ombre portée dont on a réglé l'opacité sans regarder sa couleur.
  clair: {
    sillon: 'rgba(20,38,60,.30)',
    sillonLargeur: 1.05,
    rebord: 'rgba(255,255,255,.85)',
    trou: 'rgba(20,38,60,.46)',
    ombre: 'rgba(20,38,60,.24)',
    arrets: ['#FFFFFF', '#FFFFFF', '#FCFDFF', '#EDF3FA'],
  },
}

export interface CoutureOptions {
  largeur: number
  hauteur: number
  /** Rayon de l'arrondi de la couture elle-même, pas celui de la barre. */
  rayon: number
  /**
   * `cadre` fait le tour d'un élément — la barre de navigation.
   *
   * `ligne` est une couture droite qui traverse de bord à bord, comme celle
   * qui retient une ceinture ou un empiècement. Ce n'est pas un cadre aplati :
   * un cadre est un parcours FERMÉ, où le dernier point rejoint le premier ;
   * une ligne est ouverte, et la différence se voit à ses deux extrémités.
   */
  forme?: 'cadre' | 'ligne'
  /** La toile traversée : elle décide de qui, du fil ou du pli, porte le dessin. */
  ton?: 'sombre' | 'clair'
  /** Longueur d'un point, en pixels. */
  point?: number
  /** Espace entre deux points. */
  ecart?: number
  /** Épaisseur du fil. */
  fil?: number
  /** 0 = machine parfaite, 1 = franchement artisanal. */
  desordre?: number
  graine?: number
  /** Préfixe des identifiants de dégradé : unique par instance rendue. */
  cle?: string
}

/** Générateur reproductible — même graine, même couture. */
function alea(graine: number): () => number {
  let e = graine >>> 0
  return () => {
    e = (e + 0x6d2b79f5) >>> 0
    let t = Math.imul(e ^ (e >>> 15), 1 | e)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Point = [number, number]

/** Le contour du cadre, échantillonné finement. */
function contour(w: number, h: number, r: number, pas = 0.4): Point[] {
  const pts: Point[] = []
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * r) / pas))
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / pas))
    for (let i = 0; i <= n; i++) {
      pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
    }
  }
  const P = Math.PI
  seg(r, 0, w - r, 0)
  arc(w - r, r, -P / 2, 0)
  seg(w, r, w, h - r)
  arc(w - r, h - r, 0, P / 2)
  seg(w - r, h, r, h)
  arc(r, h - r, P / 2, P)
  seg(0, h - r, 0, r)
  arc(r, r, P, 1.5 * P)
  return pts
}

interface Sur {
  x: number
  y: number
  nx: number
  ny: number
}

interface Derive {
  amplitude: number
  f1: number
  f2: number
  p1: number
  p2: number
}

/** Une couture droite, d'un bord à l'autre, à mi-hauteur de la boîte. */
function ligne(w: number, y: number, pas = 0.4): Point[] {
  const n = Math.max(2, Math.ceil(w / pas))
  return Array.from({ length: n + 1 }, (_, i) => [(w * i) / n, y] as Point)
}

function parcours(pts: Point[], derive: Derive, ferme: boolean) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i] as Point
    const b = pts[i - 1] as Point
    cum.push((cum[i - 1] as number) + Math.hypot(a[0] - b[0], a[1] - b[1]))
  }
  const total = cum[cum.length - 1] as number

  const en = (d: number): Sur => {
    // Un cadre BOUCLE : dépasser la fin, c'est revenir au début, et c'est ce
    // qui permet au dernier point de rejoindre le premier sans raccord.
    //
    // Une ligne ne boucle pas. Lui appliquer le même modulo renverrait le
    // dernier point de la couture à l'extrémité GAUCHE de la bande — un point
    // isolé, loin de ses voisins, au milieu de nulle part. On borne donc.
    const t = ferme
      ? ((d % total) + total) % total
      : Math.max(0, Math.min(total, d))
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi - 1) {
      const mi = (lo + hi) >> 1
      if ((cum[mi] as number) <= t) lo = mi
      else hi = mi
    }
    const p0 = pts[lo] as Point
    const p1 = (pts[Math.min(lo + 1, pts.length - 1)] ?? p0) as Point
    const dx = p1[0] - p0[0]
    const dy = p1[1] - p0[1]
    const n = Math.hypot(dx, dy) || 1
    const nx = -dy / n
    const ny = dx / n
    // La dérive : deux ondes de périodes incommensurables, pour qu'elle ne se
    // répète jamais à l'identique sur un tour.
    const o =
      derive.amplitude *
      (Math.sin((t / total) * Math.PI * 2 * derive.f1 + derive.p1) * 0.62 +
        Math.sin((t / total) * Math.PI * 2 * derive.f2 + derive.p2) * 0.38)
    return { x: p0[0] + nx * o, y: p0[1] + ny * o, nx, ny }
  }

  return { total, en }
}

/** Le contour fuselé d'un point : plein au milieu, pincé aux bouts. */
function fuseau(
  en: (d: number) => Sur,
  d0: number,
  longueur: number,
  demi: number,
  ga: number,
  gb: number,
  cambrure: number,
  dx = 0,
  dy = 0,
): string {
  const N = 16
  const gauche: Point[] = []
  const droite: Point[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const p = en(d0 + longueur * t)
    // L'écart glisse d'un bout à l'autre, PLUS une cambrure : un fil tendu
    // entre deux trous n'est jamais une règle.
    const glisse = ga + (gb - ga) * t + cambrure * Math.sin(Math.PI * t)
    const cx = p.x + p.nx * glisse + dx
    const cy = p.y + p.ny * glisse + dy
    const e = demi * Math.min(1, Math.pow(Math.sin(Math.PI * t), 0.3) * 1.12)
    gauche.push([cx + p.nx * e, cy + p.ny * e])
    droite.push([cx - p.nx * e, cy - p.ny * e])
  }
  return (
    [...gauche, ...droite.reverse()]
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${s[0].toFixed(2)} ${s[1].toFixed(2)}`)
      .join('') + 'Z'
  )
}

/** Renvoie le contenu SVG de la couture — sans la balise `svg` englobante. */
export function coudre({
  largeur,
  hauteur,
  rayon,
  forme = 'cadre',
  ton = 'sombre',
  point = 13,
  ecart = 3.4,
  fil = 2.6,
  desordre = 0.85,
  graine = 31,
  cle = 'c',
}: CoutureOptions): string {
  // Une ligne n'a pas besoin de hauteur : elle en occupe une poignée de
  // pixels. Lui imposer le minimum d'un cadre la ferait disparaître sur une
  // bande fine, sans erreur ni trace.
  const hauteurMinimale = forme === 'ligne' ? fil * 2 : 16
  if (largeur < 40 || hauteur < hauteurMinimale) return ''

  const ferme = forme === 'cadre'
  const teintes = TEINTES[ton]

  const rnd = alea(graine)
  const r = Math.max(2, Math.min(rayon, Math.min(largeur, hauteur) / 2 - 1))
  const pts = ferme ? contour(largeur, hauteur, r) : ligne(largeur, hauteur / 2)

  const derive: Derive = {
    // Une couture droite dérive MOINS qu'un cadre, et pour une raison
    // matérielle : sur un cadre, l'ondulation se compare au bord tout proche
    // qu'elle longe, donc elle doit rester discrète pour ne pas paraître
    // fautive. Sur une bande, la couture est seule au milieu du panneau : la
    // même amplitude s'y lirait comme une vague. C'est le regard qui change,
    // pas la main de la couturière.
    amplitude: (ferme ? 0.75 : 0.5) * desordre,
    f1: 3 + rnd() * 2,
    f2: 7 + rnd() * 4,
    p1: rnd() * 6.28,
    p2: rnd() * 6.28,
  }

  const { total, en } = parcours(pts, derive, ferme)

  const morceaux: {
    d0: number
    longueur: number
    ga: number
    gb: number
    cambrure: number
    demi: number
    mi: Sur
  }[] = []
  const trous: { x: number; y: number; r: number }[] = []

  let d = rnd() * point
  while (d < total - 2) {
    // Longueur très variable, plus un point franchement long de loin en loin :
    // une machine saute parfois.
    let longueur = point * (1 + (rnd() - 0.5) * 0.62 * desordre)
    if (rnd() < 0.07) longueur *= 1.35

    const ga = (rnd() - 0.5) * 3.1 * desordre
    const gb = (rnd() - 0.5) * 3.1 * desordre
    const cambrure = (rnd() - 0.5) * 0.9 * desordre
    const demi = (fil / 2) * (1 + (rnd() - 0.5) * 0.42 * desordre)
    // Aucune variation d'OPACITÉ sur le fil.
    //
    // Elle allait jusqu'à −29 %, et un point à 71 % laisse passer l'indigo
    // dessous : il ne paraît pas « moins éclairé », il paraît GRIS. Sur une
    // couture blanche, c'est le seul défaut qu'on remarque — quelques points
    // ternes au milieu des autres.
    //
    // L'irrégularité reste entière, mais elle est dans la FORME : longueur,
    // position, cambrure, grosseur du fil. Un fil de coton blanc reste blanc
    // d'un bout à l'autre d'une couture ; ce sont ses points qui bougent.

    morceaux.push({
      d0: d,
      longueur,
      ga,
      gb,
      cambrure,
      demi,
      mi: en(d + longueur / 2),
    })

    for (const [t, g] of [
      [0, ga],
      [1, gb],
    ] as const) {
      const p = en(d + longueur * t)
      trous.push({ x: p.x + p.nx * g, y: p.y + p.ny * g, r: demi * 0.6 })
    }

    d += longueur + ecart * (1 + (rnd() - 0.5) * 1.05 * desordre)
  }

  // Le `Z` final n'est posé QUE sur un cadre. Sur une ligne, il tracerait un
  // retour du bord droit au bord gauche : une seconde couture fantôme en
  // travers de la bande.
  const sillon =
    Array.from({ length: 900 }, (_, i) => en((total * i) / 900))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join('') + (ferme ? 'Z' : '')

  const degrades = morceaux
    .map((m, i) => {
      const e = m.demi * 1.05
      const x1 = (m.mi.x + m.mi.nx * -e).toFixed(2)
      const y1 = (m.mi.y + m.mi.ny * -e).toFixed(2)
      const x2 = (m.mi.x + m.mi.nx * e).toFixed(2)
      const y2 = (m.mi.y + m.mi.ny * e).toFixed(2)
      const [a0, a1, a2, a3] = teintes.arrets
      return `<linearGradient id="${cle}${i}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a0}"/><stop offset="0.26" stop-color="${a1}"/><stop offset="0.6" stop-color="${a2}"/><stop offset="1" stop-color="${a3}"/></linearGradient>`
    })
    .join('')

  return (
    `<defs>${degrades}</defs>` +
    // Le sillon : le pli de la toile, continu, sous toute la couture.
    `<path d="${sillon}" fill="none" stroke="${teintes.sillon}" stroke-width="${(fil * teintes.sillonLargeur).toFixed(2)}" transform="translate(0,0.5)"/>` +
    `<path d="${sillon}" fill="none" stroke="${teintes.rebord}" stroke-width="1" transform="translate(0,-0.95)"/>` +
    // Les trous d'aiguille, creusés avant que le fil ne passe dessus.
    trous
      .map(
        (t) =>
          `<ellipse cx="${t.x.toFixed(2)}" cy="${(t.y + 0.4).toFixed(2)}" rx="${(t.r * 1.15).toFixed(2)}" ry="${t.r.toFixed(2)}" fill="${teintes.trou}"/>`,
      )
      .join('') +
    // L'ombre portée du fil sur la toile.
    morceaux
      .map(
        (m) =>
          `<path d="${fuseau(en, m.d0, m.longueur, m.demi * 1.08, m.ga, m.gb, m.cambrure, 0.45, 1.1)}" fill="${teintes.ombre}"/>`,
      )
      .join('') +
    // Le fil : une seule forme, un dégradé qui la modèle.
    morceaux
      .map(
        (m, i) =>
          `<path d="${fuseau(en, m.d0, m.longueur, m.demi, m.ga, m.gb, m.cambrure)}" fill="url(#${cle}${i})"/>`,
      )
      .join('')
  )
}
