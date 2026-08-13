/**
 * Résolution de l'URL de connexion PostgreSQL.
 *
 * Les hébergeurs ne s'accordent pas sur le nom de la variable :
 *
 *  - Prisma et la convention générale : `DATABASE_URL`
 *  - intégration Vercel Postgres      : `POSTGRES_PRISMA_URL` (pooled),
 *                                       `POSTGRES_URL`,
 *                                       `POSTGRES_URL_NON_POOLING`
 *  - intégration Neon                 : `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
 *
 * Exiger `DATABASE_URL` obligeait à recopier une variable à la main pour
 * rattraper cette divergence. On accepte donc les alias connus, en préférant
 * toujours la valeur explicite quand elle existe.
 */

/** Connexion applicative. Un pool convient, et est même préférable en serverless. */
const RUNTIME_KEYS = [
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
] as const

/**
 * Connexion des migrations.
 *
 * `prisma migrate` s'appuie sur des verrous consultatifs, que les poolers en
 * mode transaction ne gèrent pas : on privilégie donc explicitement les URL
 * non poolées avant de se rabattre sur la connexion applicative.
 */
const MIGRATION_KEYS = [
  'DIRECT_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
  ...RUNTIME_KEYS,
] as const

function firstNonEmpty(
  keys: readonly string[],
  env: NodeJS.ProcessEnv,
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return { key, value: value.trim() }
    }
  }
  return null
}

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; value: string } | null {
  return firstNonEmpty(RUNTIME_KEYS, env)
}

export function resolveMigrationUrl(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; value: string } | null {
  return firstNonEmpty(MIGRATION_KEYS, env)
}

/** Une connexion passe-t-elle par un pooler en mode transaction ? */
export function looksPooled(url: string): boolean {
  return url.includes('-pooler') || url.includes('pgbouncer=true')
}

/**
 * Noms — jamais les valeurs — des variables liées à la base présentes dans
 * l'environnement. Sert au diagnostic de build : une URL de connexion contient
 * un mot de passe et n'a rien à faire dans un journal.
 */
export function presentDatabaseEnvNames(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.keys(env)
    .filter((key) => /^(DATABASE|POSTGRES|PG|NEON|SUPABASE)/.test(key))
    .filter((key) => {
      const value = env[key]
      return typeof value === 'string' && value.trim() !== ''
    })
    .sort()
}
