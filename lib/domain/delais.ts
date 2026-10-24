/**
 * Les délais en jours de la rétractation, comptés comme la loi les compte.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas « date + 14 × 24 h »
 * ---------------------------------------------------------------------------
 * C'est ce que faisait la première version, et elle se trompait d'un jour
 * deux fois par an : quatorze fois vingt-quatre heures franchissent parfois un
 * changement d'heure, et une déclaration du 20 octobre à 0 h 30 (heure de
 * Paris) annonçait le 2 novembre au lieu du 3. Le délai est un délai en JOURS
 * de calendrier, à l'heure du vendeur.
 *
 * ---------------------------------------------------------------------------
 * Le dernier jour qui tombe un samedi, un dimanche ou un jour férié
 * ---------------------------------------------------------------------------
 * Le délai court alors jusqu'à la fin du premier jour ouvrable suivant
 * (règlement 1182/71, art. 3 § 4, applicable aux délais de la directive
 * 2011/83 selon son considérant 41). Ce report profite à qui doit agir avant
 * l'échéance — ici, l'acheteuse qui renvoie ses pièces.
 *
 * Il n'est PAS appliqué à l'échéance de remboursement que l'on annonce : la
 * boutique s'engage sur la date la plus tôt, et rembourser un jour plus tôt
 * qu'il ne le faudrait n'expose à rien, l'inverse si.
 */

/** Jour civil, sans heure : année, mois (1–12), jour. */
export interface JourCivil {
  annee: number
  mois: number
  jour: number
}

const FUSEAU = 'Europe/Paris'

/** Le jour civil, à Paris, d'un instant donné. */
export function jourAParis(instant: Date): JourCivil {
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const lire = (type: string) =>
    Number(parties.find((partie) => partie.type === type)?.value)
  return { annee: lire('year'), mois: lire('month'), jour: lire('day') }
}

/**
 * Midi UTC du jour civil : un instant qui tombe le même jour dans tous les
 * fuseaux d'Europe, donc sans risque de glisser au formatage.
 */
export function midi(jour: JourCivil): Date {
  return new Date(Date.UTC(jour.annee, jour.mois - 1, jour.jour, 12))
}

function decaler(jour: JourCivil, nombre: number): JourCivil {
  const date = midi(jour)
  date.setUTCDate(date.getUTCDate() + nombre)
  return {
    annee: date.getUTCFullYear(),
    mois: date.getUTCMonth() + 1,
    jour: date.getUTCDate(),
  }
}

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus). */
function paques(annee: number): JourCivil {
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return { annee, mois, jour }
}

/**
 * Les onze jours fériés de France métropolitaine (code du travail, L3133-1).
 *
 * Les jours propres à l'Alsace-Moselle et aux outre-mer n'y sont pas : le
 * report qu'ils provoqueraient ne profite qu'à l'acheteuse, et l'omettre ne
 * fait qu'annoncer une date un jour plus tôt — jamais plus tard que la loi.
 */
function feries(annee: number): Set<string> {
  const p = paques(annee)
  const mobiles = [1, 39, 50].map((n) => decaler(p, n)) // lundi de Pâques, Ascension, lundi de Pentecôte
  const fixes: [number, number][] = [
    [1, 1],
    [5, 1],
    [5, 8],
    [7, 14],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
  ]
  return new Set([
    ...fixes.map(([mois, jour]) => cle({ annee, mois, jour })),
    ...mobiles.map(cle),
  ])
}

function cle(jour: JourCivil): string {
  return `${jour.annee}-${jour.mois}-${jour.jour}`
}

function ouvrable(jour: JourCivil): boolean {
  const semaine = midi(jour).getUTCDay()
  if (semaine === 0 || semaine === 6) return false
  return !feries(jour.annee).has(cle(jour))
}

/** `nombre` jours de calendrier après le jour, à Paris, de `depart`. */
export function apresJours(depart: Date, nombre: number): Date {
  return midi(decaler(jourAParis(depart), nombre))
}

/**
 * Comme `apresJours`, reporté au premier jour ouvrable si l'échéance tombe un
 * samedi, un dimanche ou un jour férié.
 */
export function apresJoursOuvrable(depart: Date, nombre: number): Date {
  let jour = decaler(jourAParis(depart), nombre)
  while (!ouvrable(jour)) jour = decaler(jour, 1)
  return midi(jour)
}
