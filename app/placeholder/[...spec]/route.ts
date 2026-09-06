import { NextResponse } from 'next/server'

/**
 * Images de substitution pour le jeu de données de test.
 *
 * Servies localement plutôt que depuis un service d'images externe : aucun
 * appel tiers avant consentement cookies, aucune dépendance réseau pour
 * lancer le projet, et la CSP reste fermée.
 *
 * Format : /placeholder/{graine}/{largeur}/{hauteur}
 */

/**
 * Teintes sourdes tirées de la palette, jamais saturées.
 *
 * Elles suivent la charte à CHAQUE refonte, et c'est la troisième : beiges
 * verdâtres, puis crème rosé, maintenant délavés de denim. À chaque fois,
 * elles avaient été le seul reste — les seules surfaces du jeu d'essai à
 * n'appartenir à aucune palette — et elles faussaient chaque relecture
 * visuelle en local : on croyait juger la teinte du site, on jugeait un reste.
 *
 * Elles ne peuvent PAS lire les jetons CSS : cette route fabrique un SVG servi
 * comme une image, hors de toute feuille de style. D'où des valeurs écrites en
 * dur, et d'où le fait qu'elles soient à reprendre à la main. C'est le prix de
 * l'endroit, pas un oubli — et ce commentaire est là pour que la prochaine
 * refonte n'ait pas à les redécouvrir sur une capture d'écran.
 */
const TONES = [
  { bg: '#D6DFEA', fg: '#44566E' },
  { bg: '#C7D4E3', fg: '#3C4E66' },
  { bg: '#E1E8F1', fg: '#4A5C74' },
  { bg: '#B9CADD', fg: '#36485F' },
  { bg: '#EAEFF6', fg: '#51637B' },
] as const

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function clampDimension(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, 16), 2000)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spec: string[] }> },
) {
  const { spec } = await params
  const [seed = 'article', rawWidth, rawHeight] = spec

  const width = clampDimension(rawWidth, 900)
  const height = clampDimension(rawHeight, 1200)
  const tone = TONES[hashString(seed) % TONES.length] ?? TONES[0]

  // Le libellé indique explicitement qu'il s'agit d'un visuel de test : aucune
  // ambiguïté possible avec une vraie photo produit.
  const label = seed.replace(/[^A-Za-z0-9-]/g, '').slice(0, 24)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Visuel de test ${label}">
  <rect width="${width}" height="${height}" fill="${tone.bg}"/>
  <text x="50%" y="50%" fill="${tone.fg}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${Math.round(Math.min(width, height) / 18)}" text-anchor="middle" dominant-baseline="middle" letter-spacing="1">${label}</text>
</svg>`

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
