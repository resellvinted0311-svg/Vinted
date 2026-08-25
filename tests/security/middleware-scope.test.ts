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

/**
 * Le fichier APPELLE-t-il réellement `requireAdmin()` ?
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce n'est pas un simple `includes('requireAdmin')`
 * ---------------------------------------------------------------------------
 * C'est ce qu'il était, et deux façons de le tromper ont été trouvées en le
 * mettant à l'épreuve :
 *
 *  - la ligne `import { requireAdmin } from …` suffisait. Retirer l'appel en
 *    gardant l'import laissait le test vert, sur un fichier désormais sans
 *    protection — le cas le plus probable en pratique, parce qu'on supprime
 *    une ligne de code bien plus souvent qu'un import ;
 *  - un commentaire mentionnant le nom suffisait aussi. Or ce fichier-ci en
 *    contient plusieurs, précisément pour expliquer la règle.
 *
 * On retire donc les commentaires, puis on cherche la forme APPELÉE. Un
 * contrôle textuel reste un rappel, pas une preuve — mais celui-ci ne se
 * satisfait plus d'une intention écrite.
 */
function callsRequireAdmin(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  return /\brequireAdmin\s*\(/.test(withoutComments)
}

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

/**
 * Tout fichier `'use server'` du dépôt, avec sa source.
 *
 * ---------------------------------------------------------------------------
 * Ce que le test ci-dessus ne pouvait pas voir
 * ---------------------------------------------------------------------------
 * `adminRouteFiles` ne collecte que `page`, `layout` et `route` : ce sont les
 * noms que Next reconnaît comme routes. Les Server Actions, elles, vivent dans
 * des fichiers ordinaires — `lib/admin/offer-actions.ts` — que rien ne
 * distinguait.
 *
 * Or c'est là que la protection compte le plus. Une Server Action n'est pas
 * une page : elle est appelée par un POST vers l'URL de la page qui l'a rendue,
 * et rien n'oblige un attaquant à passer par cette page. Le middleware ne la
 * voit pas ; le contrôle du rôle dans le fichier est la SEULE chose qui tienne.
 *
 * Le cahier des charges l'exige en toutes lettres — « vérification du rôle dans
 * chaque action serveur, jamais uniquement dans le middleware » — et rien ne
 * l'exerçait.
 */
function serverActionFiles(dir = 'lib'): string[] {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)

      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }

      if (!/\.tsx?$/.test(entry)) continue
      if (readFileSync(path, 'utf8').startsWith("'use server'")) found.push(path)
    }
  }

  walk(dir)
  return found
}

describe('back-office', () => {
  it('chaque route d’administration vérifie le rôle elle-même', () => {
    const offenders = adminRouteFiles().filter(
      (file) => !callsRequireAdmin(readFileSync(file, 'utf8')),
    )

    // Message explicite : ce test bavardera surtout en phase 5, au moment où
    // quelqu'un croira que le middleware suffit.
    expect(
      offenders,
      `Ces routes s'en remettent au middleware seul, qui ne voit qu'un cookie :\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('chaque ACTION SERVEUR d’administration vérifie le rôle elle-même', () => {
    // La convention qui rend ce test possible : les actions d'administration
    // vivent sous `lib/admin/`. La déplacer ailleurs sans déplacer ce test
    // rendrait la vérification muette — c'est le prix d'un contrôle par
    // convention, et il est écrit ici pour qu'on le sache.
    const adminActions = serverActionFiles().filter((file) =>
      file.split(/[\\/]/).includes('admin'),
    )

    const offenders = adminActions.filter(
      (file) => !callsRequireAdmin(readFileSync(file, 'utf8')),
    )

    expect(
      offenders,
      `Ces actions serveur sont des adresses HTTP publiques sans contrôle de rôle :\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('surveille bien quelque chose', () => {
    // Sans ce garde-fou, déplacer les actions hors de `lib/admin/` rendrait le
    // test précédent vert à vide — et c'est exactement l'état dans lequel se
    // trouvait le test des routes avant que ce dossier n'existe.
    const adminActions = serverActionFiles().filter((file) =>
      file.split(/[\\/]/).includes('admin'),
    )
    expect(adminActions.length).toBeGreaterThan(0)
    expect(adminRouteFiles().length).toBeGreaterThan(0)
  })
})
