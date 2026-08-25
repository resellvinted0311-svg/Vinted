import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Le délai de réponse ne doit rien dire de plus que la phrase.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ces tests verrouillent
 * ---------------------------------------------------------------------------
 * « Mot de passe oublié » répondait exactement la même chose que le compte
 * existe ou non — et mettait deux à cinq cents millisecondes de plus à le dire
 * quand il existait, parce qu'il ouvrait une transaction puis attendait un
 * aller-retour vers le prestataire d'e-mail. La phrase uniforme était tenue au
 * mot près pendant que le chronomètre la démentait.
 *
 * ---------------------------------------------------------------------------
 * Comment ces tests peuvent ÉCHOUER, et pourquoi c'est le point important
 * ---------------------------------------------------------------------------
 * Un test qui se contente de comparer deux durées passerait sur du code
 * corrigé comme sur du code où l'écart serait simplement passé de cinq cents à
 * cinq millisecondes — un écart qui reste mesurable en accumulant les essais.
 *
 * On injecte donc une lenteur ÉNORME et volontaire dans l'envoi : une seconde
 * et demie, soit trois fois le plancher. Si l'envoi revenait un jour dans le
 * chemin de réponse, la branche « adresse connue » la porterait tout entière et
 * l'écart deviendrait impossible à confondre avec du bruit de machine.
 */

process.env.AUTH_SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac'

/** Lenteur injectée dans l'envoi. Voir l'en-tête : elle doit être énorme. */
const SEND_LATENCY_MS = 1_500

const sendSpy = vi.fn(async () => {
  await sleep(SEND_LATENCY_MS)
})

vi.mock('@/lib/providers/email/password-reset', () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendSpy(...(args as [])),
}))

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' }),
}))

const { prisma } = await import('@/lib/db/client')
const { withTimeFloor } = await import('@/lib/security/timing')
const { __resetRateLimitForTests } = await import('@/lib/security/rate-limit')
const { requestPasswordResetAction } = await import(
  '@/lib/auth/password-reset-actions'
)
const { hashPassword } = await import('@/lib/auth/password')

const KNOWN = 'chrono-connue@nina-diego.test'
const UNKNOWN = 'chrono-inconnue@nina-diego.test'

/**
 * Marge tolérée entre les deux branches.
 *
 * Généreuse — une machine d'intégration continue partagée fait des à-coups de
 * plusieurs dizaines de millisecondes — mais sept fois plus petite que la
 * lenteur injectée. Une régression ne peut pas se cacher dedans.
 */
const TOLERANCE_MS = 200

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { contains: 'chrono-' } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  if (ids.length > 0) {
    await prisma.userToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  }
  await prisma.job.deleteMany({ where: { type: 'auth.password-reset' } })
  await prisma.user.deleteMany({ where: { email: { contains: 'chrono-' } } })
}

beforeEach(async () => {
  sendSpy.mockClear()
  __resetRateLimitForTests()
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeUser(): Promise<void> {
  await prisma.user.create({
    data: {
      email: KNOWN,
      locale: 'fr',
      passwordHash: await hashPassword('ancien-mot-de-passe-long'),
    },
  })
}

/**
 * Chronomètre UN appel, compteurs de débit remis à zéro.
 *
 * Sans la remise à zéro, le troisième appel du fichier tomberait sur le
 * plafond par empreinte d'appelant — qui répond `sent` immédiatement, donc
 * mesurerait tout autre chose que ce qu'on croit mesurer.
 */
async function timeRequest(email: string): Promise<number> {
  __resetRateLimitForTests()

  const form = new FormData()
  form.set('email', email)
  form.set('locale', 'fr')

  const started = process.hrtime.bigint()
  const state = await requestPasswordResetAction({ status: 'idle' }, form)
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

  // La phrase, elle, était déjà la même. C'est le délai qui trahissait.
  expect(state).toEqual({ status: 'sent' })

  return elapsedMs
}

describe('withTimeFloor', () => {
  it('rend la main au plus tôt au plancher, même sur un travail instantané', async () => {
    const started = process.hrtime.bigint()
    const value = await withTimeFloor(300, async () => 'fait')
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(value).toBe('fait')
    // Marge d'une milliseconde : `setTimeout` peut rendre la main un cheveu
    // avant l'échéance demandée.
    expect(elapsedMs).toBeGreaterThanOrEqual(299)
  })

  it('ne tronque pas un travail plus long que le plancher', async () => {
    const started = process.hrtime.bigint()
    await withTimeFloor(50, async () => {
      await sleep(250)
    })
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(elapsedMs).toBeGreaterThanOrEqual(249)
  })

  it('rembourre AUSSI le chemin d’exception', async () => {
    // Une branche qui échoue vite renseigne autant qu'une branche qui réussit
    // vite : c'est le même oracle, pris par l'autre bout.
    const started = process.hrtime.bigint()
    await expect(
      withTimeFloor(300, async () => {
        throw new Error('refusé')
      }),
    ).rejects.toThrow('refusé')
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(elapsedMs).toBeGreaterThanOrEqual(299)
  })
})

describe('« mot de passe oublié » : le délai ne dit rien de plus que la phrase', () => {
  it('n’attend aucun envoi : le prestataire n’est pas appelé pendant la réponse', async () => {
    await makeUser()

    const form = new FormData()
    form.set('email', KNOWN)
    form.set('locale', 'fr')
    await requestPasswordResetAction({ status: 'idle' }, form)

    // C'est la protection de FOND, celle que le plancher ne remplace pas :
    // tant qu'un appel réseau reste dans le chemin de réponse, il suffit que le
    // prestataire ralentisse pour que la branche lente dépasse n'importe quel
    // rembourrage — et cela arriverait le jour où personne ne regarde.
    expect(sendSpy).not.toHaveBeenCalled()

    // L'envoi n'est pas perdu pour autant : il est inscrit en file.
    const jobs = await prisma.job.findMany({
      where: { type: 'auth.password-reset', completedAt: null },
    })
    expect(jobs).toHaveLength(1)
  })

  it('répond dans le même temps, adresse connue ou non, même si l’envoi est lent', async () => {
    await makeUser()

    // Préchauffage : la première requête d'un fichier paie l'ouverture de la
    // connexion à la base. La compter fausserait la comparaison.
    await timeRequest(KNOWN)
    await timeRequest(UNKNOWN)

    const known = await timeRequest(KNOWN)
    const unknown = await timeRequest(UNKNOWN)

    expect(Math.abs(known - unknown)).toBeLessThan(TOLERANCE_MS)

    // Et l'écart reste très en deçà de la lenteur injectée : si l'envoi
    // revenait dans le chemin de réponse, la branche connue la porterait en
    // entier et cette assertion tomberait de plusieurs centaines de
    // millisecondes.
    expect(Math.abs(known - unknown)).toBeLessThan(SEND_LATENCY_MS / 3)
  })

  it('ne descend jamais sous le plancher, quelle que soit la branche', async () => {
    await makeUser()

    // Le plancher est à 500 ms. On vérifie qu'il est bien appliqué à l'action
    // elle-même : sans lui, le travail réel tient en quelques dizaines de
    // millisecondes, et les deux branches se distingueraient de nouveau — plus
    // finement, mais mesurablement.
    expect(await timeRequest(KNOWN)).toBeGreaterThanOrEqual(450)
    expect(await timeRequest(UNKNOWN)).toBeGreaterThanOrEqual(450)
  })
})
