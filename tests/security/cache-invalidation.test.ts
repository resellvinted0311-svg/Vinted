import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Aucune action serveur ne purge le cache de tout le site.
 *
 * ---------------------------------------------------------------------------
 * Le défaut, trouvé par audit, et ce qu'il permettait
 * ---------------------------------------------------------------------------
 * Les trois actions de panier appelaient `revalidatePath('/', 'layout')` — la
 * documentation de Next donne cette forme comme « revalidate all data ». Elle
 * purge tout ce que la mise en page racine enveloppe : les 171 pages
 * prérendues qui font, selon DEPLOY.md, « la vitesse et le référencement ».
 *
 * Et elle était déclenchable par n'importe qui. `removeBlockedLines([])` sort
 * sur `parsed.data.length === 0` avec `{ ok: true }` AVANT le moindre accès à
 * la base — pas de compte, pas de cookie, pas de requête SQL — et l'action
 * invalidait sur `result.ok`. Le seul frein était un compteur à soixante par
 * minute, déclaré `sensitive: false`, donc ouvert en cas de panne du
 * prestataire : panne qu'un attaquant provoque lui-même en épuisant le quota.
 *
 * Résultat : soixante purges complètes par minute et par adresse, contre un
 * pool réglé à UNE connexion par instance. Le catalogue n'était plus jamais
 * servi depuis le cache, et chaque régénération est une invocation facturée.
 *
 * ---------------------------------------------------------------------------
 * Ce que l'invalidation rafraîchissait : rien
 * ---------------------------------------------------------------------------
 * La justification écrite était « l'en-tête porte le compteur sur chaque page ».
 * Le code disait le contraire : `CartCountBadge` est un composant CLIENT qui lit
 * `/api/session` après hydratation et se met à jour sur un événement ; la page
 * panier est `force-dynamic` ; et les composants concernés appellent déjà
 * `router.refresh()`.
 *
 * Les actions d'offre et d'administration portaient le même appel, avec le même
 * effet nul — les pages qui montrent une négociation ou une commande sont
 * toutes `force-dynamic`, donc jamais en cache.
 *
 * ---------------------------------------------------------------------------
 * La règle que ce test fige
 * ---------------------------------------------------------------------------
 * On n'invalide que ce qui dépend réellement de ce qu'on vient d'écrire, et
 * jamais depuis un chemin qui n'a rien écrit. Une invalidation NOMMÉE reste
 * permise — c'est la forme globale qui est refusée.
 */

/** Ce qu'on refuse : la purge de tout ce que la mise en page racine enveloppe. */
const PURGE_GLOBALE = /revalidatePath\(\s*['"]\/['"]\s*,\s*['"]layout['"]\s*\)/

function sourceFiles(): string[] {
  const out: string[] = []
  const skip = new Set(['node_modules', '.next', '.git', 'dist', 'coverage'])

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }

  for (const dir of ['lib', 'app', 'components']) walk(join(process.cwd(), dir))
  return out
}

/** Retire commentaires et prose : une mention n'est pas un appel. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('invalidation de cache', () => {
  const sources = sourceFiles().map((file) => ({
    file: file.replace(`${process.cwd()}/`, ''),
    code: stripComments(readFileSync(file, 'utf8')),
  }))

  it('personne ne purge le site entier', () => {
    const fautifs = sources
      .filter(({ code }) => PURGE_GLOBALE.test(code))
      .map(({ file }) => file)

    expect(
      fautifs,
      'ces fichiers purgent TOUT le cache : sur un chemin public, c’est un ' +
        'levier de déni de service, et cela ne rafraîchit rien que les pages ' +
        'dynamiques ne relisent déjà',
    ).toEqual([])
  })

  it('surveille bien quelque chose', () => {
    // Sans ce garde-fou, une expression régulière cassée ou un parcours vide
    // rendrait le test ci-dessus vert pour la pire des raisons.
    expect(sources.length).toBeGreaterThan(50)

    // La détection fonctionne : on l'exerce sur un texte fabriqué.
    expect(PURGE_GLOBALE.test("revalidatePath('/', 'layout')")).toBe(true)
    expect(PURGE_GLOBALE.test('revalidatePath("/", "layout")')).toBe(true)
    // Et elle laisse passer une invalidation NOMMÉE, qui reste permise.
    expect(PURGE_GLOBALE.test("revalidatePath('/fr/panier', 'page')")).toBe(false)
  })
})
