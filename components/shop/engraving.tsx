/**
 * Gravures au trait.
 *
 * ---------------------------------------------------------------------------
 * Amendement au brief §11, arbitré le 13/08/2026
 * ---------------------------------------------------------------------------
 * Le brief interdisait « icônes feuille, arbre, flèches de recyclage, planète »
 * et posait que « le thème seconde main/écologie doit passer par la matière et
 * la retenue, jamais par les symboles ». L'interdit est levé sur un point
 * précis, et sur celui-là seulement :
 *
 *   - le végétal est autorisé DESSINÉ, à la manière d'une planche d'herbier
 *     gravée : trait fin, pas d'aplat, pas de dégradé ;
 *   - à GRANDE échelle uniquement — un motif de fond, jamais une vignette ;
 *   - sur les pages ÉDITORIALES seulement (accueil, à propos) ;
 *   - jamais dans un contrôle : pas de feuille dans un bouton, pas de
 *     pictogramme à côté d'un libellé, pas de flèche de recyclage.
 *
 * La distinction tient à ce que fait le dessin : une gravure est une matière,
 * un pictogramme est une revendication. Le second reste interdit.
 * ---------------------------------------------------------------------------
 *
 * Les planches sont composées par calcul plutôt que recopiées en longues
 * chaînes de path : les proportions restent lisibles et ajustables, et le
 * rendu est déterministe — aucun tirage aléatoire, donc aucune divergence
 * entre le rendu serveur et le rendu client.
 */

const TAU = Math.PI * 2

/** Point d'une courbe cubique, pour accrocher les feuilles le long de la tige. */
function pointOnCubic(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ]
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * Contour d'une feuille : deux arcs symétriques depuis le point d'attache
 * jusqu'à la pointe. La largeur est donnée en fraction de la longueur, ce qui
 * garde la même silhouette à toutes les tailles.
 */
function leafOutline(
  x: number,
  y: number,
  degrees: number,
  length: number,
  widthRatio: number,
): string {
  const angle = (degrees / 360) * TAU
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
  const [nx, ny] = [Math.cos(angle + TAU / 4), Math.sin(angle + TAU / 4)]
  const width = length * widthRatio

  const tipX = x + dx * length
  const tipY = y + dy * length
  const midX = x + dx * length * 0.45
  const midY = y + dy * length * 0.45

  const c1 = [round(midX + nx * width), round(midY + ny * width)]
  const c2 = [round(midX - nx * width), round(midY - ny * width)]

  return (
    `M${round(x)} ${round(y)}` +
    `Q${c1[0]} ${c1[1]} ${round(tipX)} ${round(tipY)}` +
    `Q${c2[0]} ${c2[1]} ${round(x)} ${round(y)}`
  )
}

/** Nervure centrale, légèrement infléchie pour éviter l'axe parfaitement droit. */
function leafVein(
  x: number,
  y: number,
  degrees: number,
  length: number,
): string {
  const angle = (degrees / 360) * TAU
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
  const [nx, ny] = [Math.cos(angle + TAU / 4), Math.sin(angle + TAU / 4)]
  const bendX = x + dx * length * 0.5 + nx * length * 0.06
  const bendY = y + dy * length * 0.5 + ny * length * 0.06

  return (
    `M${round(x)} ${round(y)}` +
    `Q${round(bendX)} ${round(bendY)} ` +
    `${round(x + dx * length * 0.94)} ${round(y + dy * length * 0.94)}`
  )
}

interface PlateProps {
  className?: string
}

/**
 * Rameau feuillu.
 *
 * Motif de fond du bandeau d'accueil. Purement décoratif : `aria-hidden`, et
 * aucune information n'en dépend.
 */
export function BranchPlate({ className }: PlateProps) {
  const p0: [number, number] = [104, 238]
  const p1: [number, number] = [98, 168]
  const p2: [number, number] = [82, 94]
  const p3: [number, number] = [54, 10]

  // Feuilles alternées le long de la tige, de la plus grande en bas à la plus
  // petite en haut. L'inclinaison se redresse en montant, comme sur un vrai
  // rameau où les feuilles jeunes sont plus serrées contre l'axe.
  const leaves = Array.from({ length: 9 }, (_, index) => {
    const t = 0.1 + index * 0.095
    const [x, y] = pointOnCubic(p0, p1, p2, p3, t)
    const toLeft = index % 2 === 0
    const spread = 58 - index * 3.2
    const degrees = toLeft ? 180 + spread : -spread
    const length = 66 - index * 4.4
    return { x, y, degrees, length }
  })

  return (
    <svg
      viewBox="0 0 200 248"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path
        d={
          `M${p0[0]} ${p0[1]}` +
          `C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]}`
        }
        strokeWidth="1.9"
      />

      {leaves.map((leaf) => (
        <g key={`${leaf.x}-${leaf.y}`}>
          <path
            d={leafOutline(leaf.x, leaf.y, leaf.degrees, leaf.length, 0.3)}
          />
          <path
            d={leafVein(leaf.x, leaf.y, leaf.degrees, leaf.length)}
            strokeWidth="1"
            opacity="0.75"
          />
        </g>
      ))}
    </svg>
  )
}

/**
 * Ombelle sèche.
 *
 * Second motif, pour les pages éditoriales qui ne sont pas l'accueil : deux
 * planches suffisent à faire un herbier, trois commenceraient à faire un thème.
 */
export function SeedHeadPlate({ className }: PlateProps) {
  const centerX = 100
  const centerY = 74
  const stemBottom = 240

  // Rayons d'ombelle : un éventail régulier, chaque rayon terminé par une
  // graine allongée.
  const rays = Array.from({ length: 13 }, (_, index) => {
    const spread = 152
    const degrees = 180 + (spread / 12) * index + (180 - spread) / 2
    const angle = (degrees / 360) * TAU
    const length = 52 + (index % 3) * 7
    return {
      degrees,
      endX: centerX + Math.cos(angle) * length,
      endY: centerY + Math.sin(angle) * length,
    }
  })

  return (
    <svg
      viewBox="0 0 200 248"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path
        d={`M${centerX} ${stemBottom}C${centerX + 6} 190 ${centerX - 4} 130 ${centerX} ${centerY}`}
        strokeWidth="1.9"
      />

      {/* Deux feuilles basses, qui ancrent la tige et évitent qu'elle flotte. */}
      <path d={leafOutline(centerX + 2, 196, 208, 54, 0.24)} />
      <path d={leafVein(centerX + 2, 196, 208, 54)} strokeWidth="1" opacity="0.75" />
      <path d={leafOutline(centerX - 1, 156, -22, 46, 0.24)} />
      <path d={leafVein(centerX - 1, 156, -22, 46)} strokeWidth="1" opacity="0.75" />

      {rays.map((ray) => (
        <g key={ray.degrees}>
          <path
            d={`M${centerX} ${centerY}L${round(ray.endX)} ${round(ray.endY)}`}
            strokeWidth="1"
            opacity="0.85"
          />
          <path
            d={leafOutline(ray.endX, ray.endY, ray.degrees, 13, 0.42)}
            strokeWidth="1.2"
          />
        </g>
      ))}
    </svg>
  )
}
