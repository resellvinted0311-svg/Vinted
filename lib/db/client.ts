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

/**
 * Compte les requêtes SQL d'un rendu, sur demande.
 *
 * `ND_TRACE_SQL=1` fait journaliser chaque requête émise. Ce n'est pas un
 * outil de développement de plus : la latence d'une page en production se lit
 * dans le NOMBRE d'allers-retours vers la base, pas dans le temps mesuré ici.
 * En local, la base répond en une fraction de milliseconde et cinquante
 * requêtes passent inaperçues ; derrière un pooler distant, à quelques
 * dizaines de millisecondes pièce, les mêmes cinquante requêtes font une
 * seconde et demie — et le `connection_limit=1` de la connexion applicative
 * les SÉRIALISE, si bien qu'aucune ne se recouvre.
 *
 * Le drapeau est donc le seul moyen d'observer, depuis une machine rapide, ce
 * qui coûtera cher sur une machine lointaine.
 */
const traceSql = process.env.ND_TRACE_SQL === '1'

function createClient(): PrismaClient {
  const resolved = resolveDatabaseUrl()

  const client = new PrismaClient({
    log: traceSql
      ? [{ emit: 'event', level: 'query' }, 'error']
      : process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
    ...(resolved ? { datasources: { db: { url: resolved.value } } } : {}),
  })

  if (traceSql) {
    // Le paramètre du client typé n'expose l'événement `query` que si `log`
    // le déclare littéralement ; ici il est conditionnel, d'où le passage par
    // une signature élargie plutôt qu'une assertion sur le client entier.
    ;(client as unknown as {
      $on: (event: 'query', cb: (e: { query: string }) => void) => void
    }).$on('query', (e) => {
      console.log(`SQL ${e.query.slice(0, 120).replace(/\s+/g, ' ')}`)
    })
  }

  return client
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
