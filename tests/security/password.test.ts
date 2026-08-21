import { describe, it, expect, beforeAll } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

/**
 * Le chronomètre ne doit pas répondre à la place du message d'erreur.
 *
 * La connexion renvoie le même texte que l'adresse soit inconnue ou le mot de
 * passe faux. Cette précaution était annulée par le temps de réponse : sans
 * empreinte à vérifier, on repartait presque instantanément. Ces tests
 * échouent sur cette version-là.
 */

const PASSWORD = 'un-mot-de-passe-assez-long'
let digest = ''

beforeAll(async () => {
  digest = await hashPassword(PASSWORD)

  // Le leurre est calculé à la première utilisation : on le provoque ici pour
  // ne pas mesurer ce coût unique dans les temps ci-dessous.
  await verifyPassword(null, 'amorce')
}, 30_000)

async function timeOf(run: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint()
  await run()
  return Number(process.hrtime.bigint() - start) / 1e6
}

async function medianOf(run: () => Promise<unknown>): Promise<number> {
  const samples: number[] = []
  for (let i = 0; i < 5; i += 1) samples.push(await timeOf(run))
  samples.sort((a, b) => a - b)
  return samples[2] as number
}

describe('verifyPassword', () => {
  it('accepte le bon mot de passe et refuse le mauvais', async () => {
    await expect(verifyPassword(digest, PASSWORD)).resolves.toBe(true)
    await expect(verifyPassword(digest, `${PASSWORD}!`)).resolves.toBe(false)
  })

  it('refuse sans lever quand il n’y a pas d’empreinte', async () => {
    // Un compte créé par lien magique n'a pas de mot de passe.
    await expect(verifyPassword(null, PASSWORD)).resolves.toBe(false)
    await expect(verifyPassword(undefined, PASSWORD)).resolves.toBe(false)
    await expect(verifyPassword('pas-un-argon2', PASSWORD)).resolves.toBe(false)
  })

  it('met le même temps à refuser un compte absent qu’un mauvais mot de passe', async () => {
    const wrongPassword = await medianOf(() =>
      verifyPassword(digest, 'mauvais-mot-de-passe-ici'),
    )
    const noAccount = await medianOf(() =>
      verifyPassword(null, 'mauvais-mot-de-passe-ici'),
    )

    // Une borne large : on cherche à écarter les deux ordres de grandeur qui
    // rendaient l'énumération triviale (fraction de milliseconde contre une
    // centaine), pas à mesurer finement une machine de CI partagée.
    expect(noAccount).toBeGreaterThan(wrongPassword * 0.5)
  }, 30_000)
})
