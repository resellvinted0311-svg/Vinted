import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Deux garde-fous autour du routage protégé.
 *
 * 1. Le middleware doit réellement s'exécuter sur les chemins qu'il prétend
 *    surveiller. L'exclusion `.*\..*` — « tout chemin contenant un point » —
 *    le désactivait sur n'importe quelle URL comportant un point, y compris
 *    sous /admin.
 *
 * 2. Le middleware ne fait pas autorité et ne peut pas la faire : sur l'Edge,
 *    il ne voit que la présence d'un cookie, pas la session ni le rôle. Toute
 *    page d'administration doit donc appeler `requireAdmin()` elle-même. Ce
 *    test passe à vide aujourd'hui — le back-office arrive en phase 5 — et
 *    mordra le jour où le dossier apparaîtra.
 */

/**
 * On lit le fichier plutôt que de l'importer : Next extrait `config.matcher`
 * statiquement à la compilation, donc la valeur DOIT rester une littérale dans
 * `middleware.ts`. La tester ailleurs testerait une copie.
 */
function shippedMatcher(): RegExp {
  const source = readFileSync('middleware.ts', 'utf8')
  const match = source.match(/matcher:\s*\[\s*'([^']+)'/)

  if (!match?.[1]) throw new Error('Matcher introuvable dans middleware.ts')

  // La chaîne du fichier contient des échappements de littéral TypeScript
  // (`\\.`) : on les ramène à leur forme d'expression régulière.
  return new RegExp(`^${match[1].replace(/\\\\/g, '\\')}$`)
}

describe('portée du middleware', () => {
  const matcher = shippedMatcher()

  it('s’exécute sur une URL protégée contenant un point', () => {
    // Le défaut corrigé, dans sa forme la plus directe.
    expect(matcher.test('/fr/admin/articles/nike.air')).toBe(true)
    expect(matcher.test('/fr/compte/commandes/2026.08')).toBe(true)
  })

  it('s’exécute sur les chemins protégés ordinaires', () => {
    expect(matcher.test('/fr/admin')).toBe(true)
    expect(matcher.test('/fr/compte')).toBe(true)
    expect(matcher.test('/en/admin/stock')).toBe(true)
  })

  it('laisse les fichiers statiques tranquilles', () => {
    for (const path of [
      '/favicon.ico',
      '/fonts/registre.woff2',
      '/sitemap.xml',
      '/robots.txt',
      '/_next/static/chunk.js',
      '/api/session',
      '/placeholder/400x600',
    ]) {
      expect(matcher.test(path), path).toBe(false)
    }
  })
})

/** Fichiers de route sous un segment nommé `admin`. */
function adminRouteFiles(dir = 'app'): string[] {
  const found: string[] = []

  const walk = (current: string, underAdmin: boolean): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)

      if (statSync(path).isDirectory()) {
        // `admin`, `(admin)` ou `[locale]/admin` : on regarde le segment nu.
        walk(path, underAdmin || entry.replace(/[()]/g, '') === 'admin')
        continue
      }

      if (underAdmin && /^(page|route|layout)\.tsx?$/.test(entry)) {
        found.push(path)
      }
    }
  }

  walk(dir, false)
  return found
}

describe('back-office', () => {
  it('chaque route d’administration vérifie le rôle elle-même', () => {
    const offenders = adminRouteFiles().filter((file) => {
      const source = readFileSync(file, 'utf8')
      return !source.includes('requireAdmin')
    })

    // Message explicite : ce test bavardera surtout en phase 5, au moment où
    // quelqu'un croira que le middleware suffit.
    expect(
      offenders,
      `Ces routes s'en remettent au middleware seul, qui ne voit qu'un cookie :\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
