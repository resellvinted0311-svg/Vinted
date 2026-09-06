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
 *     sa section — sombre au bord haut, clair au quart, moyen au centre, ombré
 *     en bas. La double inflexion donne le coton mat ; un simple
 *     clair-vers-sombre donne du métal, et trois aplats empilés donnent la
 *     perle de plastique.
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

export interface CoutureOptions {
  largeur: number
  hauteur: number
  /** Rayon de l'arrondi de la couture elle-même, pas celui de la barre. */
  rayon: number
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

function parcours(pts: Point[], derive: Derive) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i] as Point
    const b = pts[i - 1] as Point
    cum.push((cum[i - 1] as number) + Math.hypot(a[0] - b[0], a[1] - b[1]))
  }
  const total = cum[cum.length - 1] as number

  const en = (d: number): Sur => {
    const t = ((d % total) + total) % total
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
  point = 13,
  ecart = 3.4,
  fil = 2.6,
  desordre = 0.85,
  graine = 31,
  cle = 'c',
}: CoutureOptions): string {
  if (largeur < 40 || hauteur < 16) return ''

  const rnd = alea(graine)
  const r = Math.max(2, Math.min(rayon, Math.min(largeur, hauteur) / 2 - 1))
  const pts = contour(largeur, hauteur, r)

  const derive: Derive = {
    amplitude: 0.75 * desordre,
    f1: 3 + rnd() * 2,
    f2: 7 + rnd() * 4,
    p1: rnd() * 6.28,
    p2: rnd() * 6.28,
  }

  const { total, en } = parcours(pts, derive)

  const morceaux: {
    d0: number
    longueur: number
    ga: number
    gb: number
    cambrure: number
    demi: number
    eclat: number
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
    const eclat = 1 - rnd() * 0.34 * desordre

    morceaux.push({
      d0: d,
      longueur,
      ga,
      gb,
      cambrure,
      demi,
      eclat,
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

  const sillon =
    Array.from({ length: 900 }, (_, i) => en((total * i) / 900))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join('') + 'Z'

  const degrades = morceaux
    .map((m, i) => {
      const e = m.demi * 1.05
      const x1 = (m.mi.x + m.mi.nx * -e).toFixed(2)
      const y1 = (m.mi.y + m.mi.ny * -e).toFixed(2)
      const x2 = (m.mi.x + m.mi.nx * e).toFixed(2)
      const y2 = (m.mi.y + m.mi.ny * e).toFixed(2)
      return `<linearGradient id="${cle}${i}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="#EDEFF2"/><stop offset="0.26" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#F1F4F7"/><stop offset="1" stop-color="#AEBAC7"/></linearGradient>`
    })
    .join('')

  return (
    `<defs>${degrades}</defs>` +
    // Le sillon : le pli de la toile, continu, sous toute la couture.
    `<path d="${sillon}" fill="none" stroke="rgba(0,0,0,.33)" stroke-width="${(fil * 1.55).toFixed(2)}" transform="translate(0,0.5)"/>` +
    `<path d="${sillon}" fill="none" stroke="rgba(255,255,255,.085)" stroke-width="1" transform="translate(0,-0.95)"/>` +
    // Les trous d'aiguille, creusés avant que le fil ne passe dessus.
    trous
      .map(
        (t) =>
          `<ellipse cx="${t.x.toFixed(2)}" cy="${(t.y + 0.4).toFixed(2)}" rx="${(t.r * 1.15).toFixed(2)}" ry="${t.r.toFixed(2)}" fill="rgba(0,0,0,.44)"/>`,
      )
      .join('') +
    // L'ombre portée du fil sur la toile.
    morceaux
      .map(
        (m) =>
          `<path d="${fuseau(en, m.d0, m.longueur, m.demi * 1.08, m.ga, m.gb, m.cambrure, 0.45, 1.1)}" fill="rgba(0,0,0,.38)"/>`,
      )
      .join('') +
    // Le fil : une seule forme, un dégradé qui la modèle.
    morceaux
      .map(
        (m, i) =>
          `<path d="${fuseau(en, m.d0, m.longueur, m.demi, m.ga, m.gb, m.cambrure)}" fill="url(#${cle}${i})" opacity="${m.eclat.toFixed(2)}"/>`,
      )
      .join('')
  )
}
