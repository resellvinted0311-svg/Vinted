import { PrismaClient } from '@prisma/client'
import { resolveDatabaseUrl } from './database-url'

/**
 * Client Prisma en singleton.
 *
 * En développement, Next recharge les modules à chaque édition : sans ce cache
 * global on ouvrirait un nouveau pool de connexions à chaque rechargement
 * jusqu'à saturer PostgreSQL.
 *
 * L'URL est résolue explicitement plutôt que laissée à `env("DATABASE_URL")`
 * du schéma : selon l'hébergeur, la connexion arrive sous `DATABASE_URL`,
 * `POSTGRES_PRISMA_URL` ou `POSTGRES_URL`. Passer par le résolveur évite
 * d'avoir à recopier une variable à la main pour rattraper cette divergence.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  const resolved = resolveDatabaseUrl()

  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
    ...(resolved ? { datasources: { db: { url: resolved.value } } } : {}),
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
