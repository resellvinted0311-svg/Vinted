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
  wasUserinfoEncoded,
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

  it('signale un mot de passe non encodé qui aurait échappé à la réparation', () => {
    // La normalisation encode ce cas d'elle-même ; le diagnostic reste le
    // filet de sécurité pour une chaîne qui l'aurait contournée.
    const problem = describeConnectionProblem('postgresql://u:p@ss@host:5432/db')
    expect(problem).toContain('%40')
  })
})

describe('caractères réservés dans le mot de passe', () => {
  const HOST = 'aws-1-eu-west-3.pooler.supabase.com:5432/postgres'

  it('encode un « @ » laissé tel quel', () => {
    // Un nom d'hôte ne peut pas contenir « @ » : le DERNIER « @ » est donc
    // forcément le séparateur, et la réparation est sans ambiguïté.
    expect(
      normalizeConnectionString(`postgresql://postgres.abc:Xk@92mQ@${HOST}`),
    ).toBe(`postgresql://postgres.abc:Xk%4092mQ@${HOST}`)
  })

  it('encode plusieurs « @ » du même mot de passe', () => {
    expect(
      normalizeConnectionString(`postgresql://postgres.abc:a@b@c@${HOST}`),
    ).toBe(`postgresql://postgres.abc:a%40b%40c@${HOST}`)
  })

  it('encode « # » et « ? », qui tronqueraient l’autorité', () => {
    expect(
      normalizeConnectionString(`postgresql://postgres.abc:a#b?c@${HOST}`),
    ).toBe(`postgresql://postgres.abc:a%23b%3Fc@${HOST}`)
  })

  it('encode un « : » surnuméraire sans casser la séparation', () => {
    expect(
      normalizeConnectionString(`postgresql://postgres.abc:a:b@${HOST}`),
    ).toBe(`postgresql://postgres.abc:a%3Ab@${HOST}`)
  })

  it('la réparation rend la chaîne exploitable', () => {
    const repaired = normalizeConnectionString(
      `postgresql://postgres.abc:Xk@92mQ@${HOST}`,
    )
    // Sans encodage, `new URL` retenait le dernier « @ » et le pilote se
    // connectait au mauvais hôte.
    expect(new URL(repaired).hostname).toBe('aws-1-eu-west-3.pooler.supabase.com')
    // Sans perte : le mot de passe transmis reste celui qui était écrit.
    expect(decodeURIComponent(new URL(repaired).password)).toBe('Xk@92mQ')
    expect(describeConnectionProblem(repaired)).toBeNull()
  })

  it('ne touche pas une chaîne déjà correcte', () => {
    const clean = `postgresql://postgres.abc:Xk92mQvz@${HOST}`
    expect(normalizeConnectionString(clean)).toBe(clean)
    expect(wasUserinfoEncoded(clean)).toBe(false)
  })

  it('ne double pas un encodage déjà présent', () => {
    const already = `postgresql://postgres.abc:Xk%4092mQ@${HOST}`
    expect(normalizeConnectionString(already)).toBe(already)
  })

  it('laisse intacte une URL sans mot de passe', () => {
    const noPassword = 'postgresql://postgres@localhost:5432/nina'
    expect(normalizeConnectionString(noPassword)).toBe(noPassword)
  })

  it('la résolution répare et le signale', () => {
    const resolved = resolveMigrationUrl({
      DIRECT_URL: `postgresql://postgres.abc:Xk@92mQ@${HOST}`,
    })
    expect(resolved?.value).toContain('%40')
    expect(resolved?.repaired).toBe(true)
  })

  it('des guillemets retirés ne comptent pas comme une réparation', () => {
    const resolved = resolveMigrationUrl({
      DIRECT_URL: `"postgresql://postgres.abc:Xk92mQvz@${HOST}"`,
    })
    expect(resolved?.repaired).toBe(false)
  })
})

describe('identifiant Supabase', () => {
  const REF = 'jtjkdcldtabc'

  it('refuse « postgres » seul sur un hôte pooler', () => {
    // Cas réel : hôte du pooler mais identifiant de la connexion directe.
    // Prisma répond alors P1000 sans jamais désigner l'identifiant.
    const problem = describeConnectionProblem(
      `postgresql://postgres:pw@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`,
    )
    expect(problem).not.toBeNull()
    expect(problem).toContain('postgres.<référence-du-projet>')
  })

  it('accepte « postgres.<ref> » sur un hôte pooler', () => {
    expect(
      describeConnectionProblem(
        `postgresql://postgres.${REF}:pw@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`,
      ),
    ).toBeNull()
  })

  it('accepte « postgres » seul en connexion directe', () => {
    expect(
      describeConnectionProblem(
        `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`,
      ),
    ).toBeNull()
  })

  it('refuse « postgres.<ref> » sur l’hôte de connexion directe', () => {
    expect(
      describeConnectionProblem(
        `postgresql://postgres.${REF}:pw@db.${REF}.supabase.co:5432/postgres`,
      ),
    ).not.toBeNull()
  })

  it('ne juge pas l’identifiant hors de Supabase', () => {
    expect(
      describeConnectionProblem('postgresql://postgres:pw@localhost:5432/nina'),
    ).toBeNull()
  })
})

describe('marqueur de mot de passe non remplacé', () => {
  const HOST = 'aws-1-eu-west-3.pooler.supabase.com:5432/postgres'

  it('signale [YOUR-PASSWORD] laissé tel quel', () => {
    const problem = describeConnectionProblem(
      `postgresql://postgres.abc:[YOUR-PASSWORD]@${HOST}`,
    )
    expect(problem).toContain('texte à remplacer')
  })

  it('signale la variante encodée par un copier-coller', () => {
    // Les crochets sont souvent encodés au passage dans une interface web.
    const problem = describeConnectionProblem(
      `postgresql://postgres.abc:%5BYOUR-PASSWORD%5D@${HOST}`,
    )
    expect(problem).toContain('texte à remplacer')
  })

  it('signale la variante en chevrons', () => {
    expect(
      describeConnectionProblem(`postgresql://postgres.abc:<password>@${HOST}`),
    ).toContain('texte à remplacer')
  })

  it('signale un mot de passe absent', () => {
    expect(
      describeConnectionProblem(`postgresql://postgres.abc:@${HOST}`),
    ).toContain('aucun mot de passe')
  })

  it('accepte un vrai mot de passe', () => {
    expect(
      describeConnectionProblem(`postgresql://postgres.abc:Xk92mQvz@${HOST}`),
    ).toBeNull()
  })

  it('n’alerte pas sur un mot de passe contenant un crochet encodé', () => {
    // %5B est un crochet légitime dans un mot de passe généré ; seul un
    // COUPLE de crochets encadrant du texte trahit un marqueur.
    expect(
      describeConnectionProblem(`postgresql://postgres.abc:Xk%5B92mQvz@${HOST}`),
    ).toBeNull()
  })
})
