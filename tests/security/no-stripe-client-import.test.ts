import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Les paquets Stripe côté navigateur ne sont importés qu'à UN endroit.
 *
 * ---------------------------------------------------------------------------
 * Ce n'est pas une règle de propreté
 * ---------------------------------------------------------------------------
 * `@stripe/stripe-js` insère un script servi par Stripe dans le document.
 * Importé depuis un composant partagé, une mise en page ou l'en-tête, ce
 * script se chargerait sur des pages où personne ne paie — donc sur des pages
 * publiques, prérendues, et avant tout consentement.
 *
 * Le cahier des charges interdit explicitement de charger un script tiers
 * avant le consentement aux cookies. Cette limite-là ne se surveille pas à
 * l'œil : un import ajouté par commodité dans six mois ne produirait aucune
 * erreur, aucun avertissement, et se verrait uniquement dans l'onglet réseau
 * d'une page d'accueil.
 */

const ROOT = new URL('../..', import.meta.url).pathname

/** Le seul fichier autorisé, chemin relatif à la racine du dépôt. */
const ALLOWED = join('components', 'shop', 'checkout', 'embedded-payment.tsx')

const SEARCHED = ['app', 'components', 'lib', 'middleware.ts']
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

function collect(target: string, found: string[] = []): string[] {
  const stats = statSync(target, { throwIfNoEntry: false })
  if (!stats) return found

  if (stats.isFile()) {
    if (EXTENSIONS.some((ext) => target.endsWith(ext))) found.push(target)
    return found
  }

  for (const entry of readdirSync(target)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    collect(join(target, entry), found)
  }
  return found
}

describe('cloisonnement du script de paiement', () => {
  it('n’importe @stripe/* que depuis le module de paiement embarqué', () => {
    const files = SEARCHED.flatMap((entry) => collect(join(ROOT, entry)))

    // On cherche la FORME d'import, pas la simple mention du nom : les
    // commentaires de ce dépôt parlent abondamment de Stripe, et les
    // interdire n'aiderait personne.
    const pattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@stripe\/[^'"]+['"]/

    const offenders = files
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))

    expect(offenders).toEqual([ALLOWED.split(sep).join(sep)])
  })

  it('surveille bien quelque chose', () => {
    // Sans cette vérification, un chemin de recherche mal orthographié
    // rendrait le test ci-dessus vert en n'inspectant aucun fichier.
    const files = SEARCHED.flatMap((entry) => collect(join(ROOT, entry)))
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.endsWith(ALLOWED))).toBe(true)
  })
})
