import { PrismaClient } from '@prisma/client'

/**
 * Client Prisma en singleton.
 *
 * En développement, Next recharge les modules à chaque édition : sans ce cache
 * global on ouvrirait un nouveau pool de connexions à chaque rechargement
 * jusqu'à saturer PostgreSQL.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
