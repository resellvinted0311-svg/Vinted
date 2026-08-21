import { describe, it, expect, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getSettings } from '@/lib/config/settings'
import { getShippingGrids } from '@/lib/db/queries/shipping'

/**
 * Le défaut qui ne se voit qu'en production.
 *
 * En serverless derrière un pooler, la connexion applicative est réglée à UNE
 * seule (`connection_limit=1`, recommandation de Prisma). Une transaction
 * interactive tient cette connexion du début à la fin. Toute requête émise
 * pendant ce temps AVEC LE CLIENT GLOBAL en demande une seconde — qui ne se
 * libérera qu'à la fin de la transaction, laquelle attend cette requête.
 * Interblocage jusqu'au délai d'attente du pool.
 *
 * En développement, aucune limite n'est posée : le code passe, les tests
 * passent, et la boutique tombe le jour du premier paiement réel. Ce test
 * reproduit donc la contrainte de production explicitement.
 *
 * Si quelqu'un fait un jour repasser `getSettings` ou `getShippingGrids` par
 * le client global, ce test s'arrête net sur un dépassement de délai.
 */

/** Reproduit la connexion de production : une seule, et une attente courte. */
function poolOfOne(): PrismaClient {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL absente')

  const url = new URL(base)
  url.searchParams.set('connection_limit', '1')
  // Court volontairement : on veut un échec en quelques secondes, pas une
  // suite de tests qui semble bloquée.
  url.searchParams.set('pool_timeout', '5')

  return new PrismaClient({ datasources: { db: { url: url.toString() } } })
}

const client = poolOfOne()

afterAll(async () => {
  await client.$disconnect()
})

describe('lectures de configuration dans une transaction', () => {
  it('les réglages se lisent avec la connexion de la transaction', async () => {
    const settings = await client.$transaction(async (tx) => {
      return getSettings(['packagingWeightGrams', 'shippingMarkupPercent'], tx)
    })

    expect(settings.packagingWeightGrams).toBeGreaterThanOrEqual(0)
  }, 20_000)

  it('les grilles de port aussi', async () => {
    const grids = await client.$transaction(async (tx) => {
      return getShippingGrids(tx)
    })

    expect(grids.zones.length).toBeGreaterThan(0)
    expect(grids.rates.length).toBeGreaterThan(0)
  }, 20_000)

  it('les deux ensemble, comme le fait l’ouverture d’un paiement', async () => {
    // C'est la séquence exacte de `prepareCheckoutFor`.
    const result = await client.$transaction(async (tx) => {
      const settings = await getSettings(
        [
          'packagingWeightGrams',
          'shippingMarkupPercent',
          'reservationTtlMinutes',
          'cgvVersion',
        ],
        tx,
      )
      const grids = await getShippingGrids(tx)
      return { settings, grids }
    })

    expect(result.settings.reservationTtlMinutes).toBeGreaterThan(0)
    expect(result.grids.zones.length).toBeGreaterThan(0)
  }, 20_000)

  it('le client global, lui, s’enlise réellement — c’est le défaut corrigé', async () => {
    // On le démontre plutôt que de l'affirmer.
    //
    // À l'intérieur de la transaction, `client` (et non `tx`) demande une
    // SECONDE connexion au pool. Il n'y en a qu'une, et la transaction la
    // tient : la requête attend une connexion qui ne se libérera qu'à la fin
    // de la transaction, laquelle attend cette requête. Interblocage, jusqu'au
    // délai d'attente du pool — P2024.
    //
    // C'est exactement ce que faisait l'ouverture d'un paiement avant
    // correction, et ce qu'aucun test ne voyait parce que la base de
    // développement ne pose aucune limite de connexions.
    await expect(
      client.$transaction(async () => {
        return client.setting.findMany({ take: 1 })
      }),
    ).rejects.toThrow()
  }, 30_000)
})
