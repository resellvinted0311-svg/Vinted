/**
 * Le catalogue est-il vide ?
 *
 * Sortie 0 si oui, 1 si non. Sert au script de build à décider s'il faut
 * insérer le jeu de démonstration, sans imposer de variable d'environnement :
 * un premier déploiement trouve une base vide et la peuple, les suivants
 * n'y touchent pas.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const count = await prisma.article.count()
  console.log(`Articles en base : ${count}`)
  process.exit(count === 0 ? 0 : 1)
} catch (error) {
  // Une base injoignable n'est pas « vide » : on ne seede pas à l'aveugle.
  console.error(
    `Impossible de compter les articles : ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
