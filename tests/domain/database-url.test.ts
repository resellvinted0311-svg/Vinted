import { describe, it, expect } from 'vitest'
import {
  resolveDatabaseUrl,
  resolveMigrationUrl,
  looksPooled,
  withPoolerParams,
  blocksMigrations,
  normalizeConnectionString,
  describeConnectionProblem,
  presentDatabaseEnvNames,
} from '@/lib/db/database-url'

/**
 * Résolution de la connexion PostgreSQL.
 *
 * Chaque hébergeur nomme la connexion différemment et n'expose pas les mêmes
 * garanties. Ces tests figent le comportement attendu pour les trois que le
 * projet est susceptible de rencontrer : Supabase, Neon et Vercel Postgres.
 */

const SUPABASE = {
  POSTGRES_PRISMA_URL:
    'postgres://postgres.abc:pw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
  POSTGRES_URL_NON_POOLING:
    'postgres://postgres.abc:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres',
}

const NEON = {
  DATABASE_URL: 'postgres://u:pw@ep-x-pooler.eu-central-1.aws.neon.tech/db',
  DATABASE_URL_UNPOOLED: 'postgres://u:pw@ep-x.eu-central-1.aws.neon.tech/db',
}

const LOCAL = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nina_diego?schema=public',
}

describe('détection d’un pooler', () => {
  it('reconnaît le pooler Supabase (port 6543 et hôte .pooler.)', () => {
    expect(looksPooled(SUPABASE.POSTGRES_PRISMA_URL )).toBe(true)
  })

  it('reconnaît le pooler Neon (hôte suffixé -pooler)', () => {
    expect(looksPooled(NEON.DATABASE_URL )).toBe(true)
  })

  it('ne signale pas une connexion locale directe', () => {
    expect(looksPooled(LOCAL.DATABASE_URL )).toBe(false)
  })
})

describe('paramètres de pooler', () => {
  it('ajoute pgbouncer et connection_limit sur une URL poolée', () => {
    const url = withPoolerParams(SUPABASE.POSTGRES_PRISMA_URL )
    expect(url).toContain('pgbouncer=true')
    expect(url).toContain('connection_limit=1')
  })

  it('n’ajoute rien à une connexion directe', () => {
    expect(withPoolerParams(LOCAL.DATABASE_URL )).toBe(
      LOCAL.DATABASE_URL,
    )
  })

  it('respecte un paramètre déjà présent', () => {
    const existing = `${SUPABASE.POSTGRES_PRISMA_URL}?pgbouncer=true&connection_limit=5`
    expect(withPoolerParams(existing)).toBe(existing)
  })

  it('enchaîne correctement sur une URL qui porte déjà des paramètres', () => {
    const url = withPoolerParams(`${SUPABASE.POSTGRES_PRISMA_URL}?sslmode=require`)
    expect(url).toContain('?sslmode=require&')
    expect(url).not.toContain('??')
  })
})

describe('résolution', () => {
  it('Supabase : applicatif poolé, migrations en direct', () => {
    const runtime = resolveDatabaseUrl(SUPABASE)
    const migration = resolveMigrationUrl(SUPABASE)

    expect(runtime?.key).toBe('POSTGRES_PRISMA_URL')
    expect(migration?.key).toBe('POSTGRES_URL_NON_POOLING')
    // Les migrations utilisent des verrous consultatifs, incompatibles avec
    // un pooler en mode transaction : elles doivent passer par le port 5432.
    expect(migration?.value).toContain(':5432')
  })

  it('Neon : applicatif poolé, migrations sur l’URL non poolée', () => {
    expect(resolveDatabaseUrl(NEON)?.key).toBe('DATABASE_URL')
    expect(resolveMigrationUrl(NEON)?.key).toBe('DATABASE_URL_UNPOOLED')
  })

  it('une valeur explicite l’emporte sur les alias', () => {
    const env = { ...SUPABASE, DATABASE_URL: LOCAL.DATABASE_URL, DIRECT_URL: LOCAL.DATABASE_URL }
    expect(resolveDatabaseUrl(env)?.key).toBe('DATABASE_URL')
    expect(resolveMigrationUrl(env)?.key).toBe('DIRECT_URL')
  })

  it('retombe sur la connexion applicative faute d’URL directe', () => {
    expect(resolveMigrationUrl(LOCAL)?.key).toBe('DATABASE_URL')
  })

  it('renvoie null quand rien n’est défini', () => {
    expect(resolveDatabaseUrl({})).toBeNull()
    expect(resolveMigrationUrl({})).toBeNull()
  })

  it('ignore une variable définie mais vide', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '   ' })).toBeNull()
  })
})

describe('diagnostic', () => {
  it('liste les noms présents, jamais les valeurs', () => {
    const names = presentDatabaseEnvNames({
      ...SUPABASE,
      SUPABASE_ANON_KEY: 'clé',
      AUTH_SECRET: 'secret',
    })

    expect(names).toContain('POSTGRES_PRISMA_URL')
    expect(names).toContain('SUPABASE_ANON_KEY')
    // Hors périmètre : on ne divulgue pas l'inventaire complet des secrets.
    expect(names).not.toContain('AUTH_SECRET')
    for (const name of names) {
      expect(name).not.toContain('pw')
    }
  })
})

describe('mode du pooler', () => {
  it('le mode session de Supabase (5432) n’empêche pas les migrations', () => {
    // Même hôte que le mode transaction : seul le port distingue les deux.
    expect(
      blocksMigrations(SUPABASE.POSTGRES_URL_NON_POOLING),
    ).toBe(false)
  })

  it('le mode transaction (6543) les empêche', () => {
    expect(blocksMigrations(SUPABASE.POSTGRES_PRISMA_URL)).toBe(true)
  })

  it('une connexion directe ne les empêche pas', () => {
    expect(blocksMigrations(LOCAL.DATABASE_URL)).toBe(false)
  })
})

describe('chaînes recopiées à la main', () => {
  const CLEAN =
    'postgresql://postgres.abc:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'

  it('retire les guillemets doubles encadrants', () => {
    expect(normalizeConnectionString(`"${CLEAN}"`)).toBe(CLEAN)
  })

  it('retire les guillemets simples encadrants', () => {
    expect(normalizeConnectionString(`'${CLEAN}'`)).toBe(CLEAN)
  })

  it('retire un préfixe NOM= recopié depuis un .env', () => {
    expect(normalizeConnectionString(`DATABASE_URL="${CLEAN}"`)).toBe(CLEAN)
    expect(normalizeConnectionString(`DIRECT_URL=${CLEAN}`)).toBe(CLEAN)
  })

  it('n’ampute pas un mot de passe contenant un =', () => {
    const withEquals = 'postgresql://user:ab=cd@host:5432/postgres'
    expect(normalizeConnectionString(withEquals)).toBe(withEquals)
  })

  it('absorbe les espaces et retours à la ligne', () => {
    expect(normalizeConnectionString(`  ${CLEAN}\n`)).toBe(CLEAN)
  })

  it('la résolution applique le nettoyage', () => {
    const resolved = resolveMigrationUrl({ DIRECT_URL: `"${CLEAN}"` })
    expect(resolved?.value).toBe(CLEAN)
  })
})

describe('diagnostic de forme', () => {
  it('accepte une chaîne valide', () => {
    expect(
      describeConnectionProblem(
        'postgresql://u:p@host:5432/postgres?pgbouncer=true',
      ),
    ).toBeNull()
  })

  it('signale un schéma absent sans divulguer le mot de passe', () => {
    const problem = describeConnectionProblem('"postgresql://u:secret@host/db')
    expect(problem).not.toBeNull()
    expect(problem).not.toContain('secret')
  })

  it('signale une commande psql collée par erreur', () => {
    expect(describeConnectionProblem('psql "postgresql://u:p@h/db"')).not.toBeNull()
  })

  it('signale un mot de passe non encodé', () => {
    const problem = describeConnectionProblem('postgresql://u:p@ss@host:5432/db')
    expect(problem).toContain('%40')
  })
})
