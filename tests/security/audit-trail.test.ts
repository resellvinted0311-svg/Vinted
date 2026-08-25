import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { __auditInternals } from '@/lib/audit/trail'
import { AUDIT_LOG_RETENTION_DAYS, PROCESSING_REGISTER } from '@/lib/config/privacy'

/**
 * La piste d'audit ne doit jamais devenir une copie de données personnelles.
 *
 * ---------------------------------------------------------------------------
 * Le défaut qu'on empêche avant qu'il n'arrive
 * ---------------------------------------------------------------------------
 * `AuditLog.before` et `AuditLog.after` sont des colonnes `Json` LIBRES. Rien,
 * dans le schéma, n'interdit d'y écrire une ligne `User` entière — et c'est le
 * geste le plus naturel du monde le jour où l'on voudra tracer une
 * modification :
 *
 *     await tx.auditLog.create({ data: { ..., before: ancien, after: nouveau } })
 *
 * Ce jour-là, la table devient une copie intégrale de données personnelles :
 * hors registre, hors export de l'article 15, hors effacement. `docs/rgpd.md`
 * l'inscrivait déjà comme « table à surveiller ». Une note de vigilance ne
 * protège rien : personne ne la relit au moment d'ajouter une ligne de code.
 *
 * Ce fichier transforme la vigilance en contrainte.
 */

const { cleanPayload, REDACTED } = __auditInternals

describe('le contenu consigné est filtré', () => {
  it('retire une adresse e-mail glissée dans une valeur', () => {
    const cleaned = cleanPayload({ reason: 'doublon sur camille@exemple.fr' }) as
      | Record<string, unknown>
      | undefined

    expect(String(cleaned?.reason)).not.toContain('camille@exemple.fr')
    expect(String(cleaned?.reason)).toContain(REDACTED)
  })

  it('filtre aussi à l’intérieur d’un tableau', () => {
    // C'est la forme réelle de l'unique écriture d'aujourd'hui — un tableau
    // d'identifiants. Une valeur personnelle qui s'y glisserait passerait
    // inaperçue si seuls les scalaires nus étaient filtrés.
    const cleaned = cleanPayload({ notes: ['ok', 'écrire à camille@exemple.fr'] }) as
      | Record<string, string[]>
      | undefined

    expect(JSON.stringify(cleaned)).not.toContain('camille@exemple.fr')
  })

  it('garde les identifiants internes, qui sont tout l’intérêt de la trace', () => {
    const cleaned = cleanPayload({
      articleIds: ['art_1', 'art_2'],
      lines: 2,
      refundDue: true,
    }) as Record<string, unknown>

    expect(cleaned.articleIds).toEqual(['art_1', 'art_2'])
    expect(cleaned.lines).toBe(2)
    expect(cleaned.refundDue).toBe(true)
  })

  it('borne la longueur et le nombre d’entrées', () => {
    const cleaned = cleanPayload({
      long: 'x'.repeat(1_000),
      many: Array.from({ length: 500 }, (_, i) => `art_${i}`),
    }) as Record<string, unknown>

    expect(String(cleaned.long).length).toBeLessThan(250)
    expect((cleaned.many as string[]).length).toBeLessThanOrEqual(100)
  })

  it('n’écrit rien quand il n’y a rien à écrire', () => {
    expect(cleanPayload(undefined)).toBeUndefined()
  })
})

/**
 * Parcourt les sources du projet, en écartant ce qui n'est pas du code écrit
 * à la main.
 */
function sourceFiles(root: string): string[] {
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

  walk(root)
  return out
}

/** Retire commentaires et chaînes : une mention en prose n'est pas un appel. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('personne ne contourne le module', () => {
  it('aucun appel direct à auditLog.create hors de lib/audit/trail.ts', () => {
    // ------------------------------------------------------------------
    // Pourquoi un test qui lit les fichiers plutôt qu'un type
    // ------------------------------------------------------------------
    // Le type de `recordAudit` interdit les objets imbriqués — mais il ne peut
    // pas empêcher quelqu'un d'appeler Prisma directement à côté. Rien dans le
    // langage ne rend une table inaccessible. La seule barrière possible est
    // celle-ci : une lecture du dépôt, qui échoue bruyamment.
    //
    // C'est le même geste que `tests/security/middleware-scope.test.ts`, qui
    // exige `requireAdmin()` littéralement dans chaque fichier d'administration.
    const fautifs: string[] = []

    for (const dir of ['lib', 'app', 'components']) {
      for (const file of sourceFiles(join(process.cwd(), dir))) {
        if (file.endsWith(join('lib', 'audit', 'trail.ts'))) continue

        const source = stripComments(readFileSync(file, 'utf8'))
        if (/\bauditLog\s*\.\s*create\b/.test(source)) {
          fautifs.push(file.replace(`${process.cwd()}/`, ''))
        }
      }
    }

    expect(
      fautifs,
      'ces fichiers écrivent dans AuditLog sans passer par recordAudit() : ' +
        'le contenu n’y est plus borné, et une ligne User entière peut y entrer',
    ).toEqual([])
  })

  it('le seul chemin autorisé, lui, écrit bien dans la table', () => {
    // Sans ce garde-fou, renommer la table ou casser `recordAudit` rendrait le
    // test ci-dessus vert pour la pire des raisons : plus personne n'écrit.
    const source = readFileSync(
      join(process.cwd(), 'lib', 'audit', 'trail.ts'),
      'utf8',
    )
    expect(stripComments(source)).toMatch(/\bauditLog\s*\.\s*create\b/)
  })

  it('au moins un appelant consigne réellement quelque chose', () => {
    const appelants = sourceFiles(join(process.cwd(), 'lib')).filter((file) =>
      /\brecordAudit\s*\(/.test(stripComments(readFileSync(file, 'utf8'))),
    )

    // `trail.ts` définit la fonction sans l'appeler : on attend donc un
    // appelant EXTÉRIEUR. Une piste d'audit que rien n'alimente serait une
    // conformité de façade.
    expect(
      appelants.filter((f) => !f.endsWith(join('lib', 'audit', 'trail.ts'))).length,
    ).toBeGreaterThan(0)
  })
})

describe('la table est déclarée et purgée', () => {
  it('figure au registre des traitements', () => {
    // Un traitement non déclaré est un traitement qu'on oublie de purger —
    // c'est exactement ce qui était arrivé à celui-ci.
    const entry = PROCESSING_REGISTER.find(
      (processing) => processing.key === 'audit-trail',
    )

    expect(entry).toBeDefined()
    expect(entry!.tables).toContain('AuditLog')
    expect(entry!.retentionDays).toBe(AUDIT_LOG_RETENTION_DAYS)
  })

  it('annonce une durée que la purge peut appliquer', () => {
    // Ni `null` (tant que le compte existe — cette table n'appartient à aucun
    // compte) ni `'external'` (elle est dans NOTRE base, personne d'autre ne
    // peut la vider).
    expect(typeof AUDIT_LOG_RETENTION_DAYS).toBe('number')
    expect(AUDIT_LOG_RETENTION_DAYS).toBeGreaterThan(0)
  })
})
