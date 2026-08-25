import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

/**
 * L'envoi du lien de réinitialisation, devenu un travail différé.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce déplacement devait préserver
 * ---------------------------------------------------------------------------
 * Sortir l'envoi du chemin de réponse fermait une fuite par le temps. Mais
 * déplacer un envoi, c'est déplacer tout ce qui l'accompagne, et trois choses
 * pouvaient se casser sans bruit :
 *
 *  - le JETON. Il n'existe qu'en clair, le temps d'être mis dans un lien. Le
 *    faire voyager dans `Job.payload` — une colonne `Json` conservée un mois —
 *    aurait défait la précaution qui fait que `UserToken` n'en garde qu'une
 *    empreinte. Il est donc créé PAR le travail ;
 *  - l'ADRESSE, pour la même raison : elle est relue à l'exécution, jamais
 *    recopiée dans la charge utile ;
 *  - l'UNICITÉ de l'envoi. Chaque envoi crée un jeton qui invalide le
 *    précédent. Deux envois pour une seule demande, ce n'est pas un doublon
 *    gênant : c'est un premier lien mort dans la boîte de la personne, qui
 *    cliquera dessus et lira « ce lien n'est plus valide ».
 */

process.env.AUTH_SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac'

const sendSpy = vi.fn(async (_message: { to: string; url: string; expires: Date }) => {})

vi.mock('@/lib/providers/email/password-reset', () => ({
  sendPasswordResetEmail: (message: { to: string; url: string; expires: Date }) =>
    sendSpy(message),
}))

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '198.51.100.4', 'user-agent': 'vitest' }),
}))

const { prisma } = await import('@/lib/db/client')
const { __resetRateLimitForTests } = await import('@/lib/security/rate-limit')
const { requestPasswordResetAction } = await import(
  '@/lib/auth/password-reset-actions'
)
const { runJobNow, runJobs } = await import('@/lib/jobs/worker')
const { lookupPasswordReset } = await import('@/lib/auth/password-reset')
const { hashPassword } = await import('@/lib/auth/password')

const EMAIL = 'travail-reinit@nina-diego.test'

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { contains: 'travail-reinit' } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  if (ids.length > 0) {
    await prisma.userToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  }
  await prisma.job.deleteMany({ where: { type: 'auth.password-reset' } })
  await prisma.user.deleteMany({
    where: { email: { contains: 'travail-reinit' } },
  })
}

beforeEach(async () => {
  sendSpy.mockClear()
  sendSpy.mockImplementation(async () => {})
  __resetRateLimitForTests()
  await cleanup()
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeUser(): Promise<{ id: string; email: string }> {
  return prisma.user.create({
    data: {
      email: EMAIL,
      locale: 'fr',
      passwordHash: await hashPassword('ancien-mot-de-passe-long'),
    },
    select: { id: true, email: true },
  })
}

/** Demande un lien et renvoie le travail inscrit. */
async function request(): Promise<{ id: string; payload: unknown }> {
  __resetRateLimitForTests()

  const form = new FormData()
  form.set('email', EMAIL)
  form.set('locale', 'fr')

  const state = await requestPasswordResetAction({ status: 'idle' }, form)
  expect(state).toEqual({ status: 'sent' })

  const job = await prisma.job.findFirst({
    where: { type: 'auth.password-reset' },
    select: { id: true, payload: true },
    orderBy: { createdAt: 'desc' },
  })
  expect(job).not.toBeNull()

  return job as { id: string; payload: unknown }
}

/** Le jeton en clair, extrait du lien qu'a reçu le gabarit d'e-mail. */
function tokenFromLastSend(): string {
  const message = sendSpy.mock.calls.at(-1)?.[0]
  expect(message).toBeDefined()
  const segments = new URL(message!.url).pathname.split('/')
  return segments[segments.length - 1] ?? ''
}

describe('la demande inscrit un travail, elle n’envoie rien', () => {
  it('écrit exactement un travail, et aucun jeton', async () => {
    const user = await makeUser()
    await request()

    expect(sendSpy).not.toHaveBeenCalled()

    // Aucun `UserToken` à ce stade : le jeton naît avec l'envoi, pas avec la
    // demande. C'est ce qui lui évite de traverser la file en clair.
    //
    // Compté SUR CE COMPTE, pas sur toute la table : la base de test est
    // partagée avec les autres fichiers, et un compteur global mesurerait leurs
    // jeux de données autant que le nôtre.
    const tokens = await prisma.userToken.count({
      where: { userId: user.id, type: 'password-reset' },
    })
    expect(tokens).toBe(0)
  })

  it('ne fait voyager NI l’adresse NI le jeton dans la charge utile', async () => {
    const user = await makeUser()
    const job = await request()

    // Le registre déclare `Job` comme ne portant que des identifiants
    // internes. Cette assertion est ce qui le rend vrai plutôt que déclaratif.
    expect(job.payload).toEqual({ userId: user.id, locale: 'fr' })
    expect(JSON.stringify(job.payload)).not.toContain(EMAIL)
    expect(JSON.stringify(job.payload)).not.toContain('travail-reinit')
  })
})

describe('l’exécution du travail envoie le lien', () => {
  it('crée un jeton utilisable et l’envoie à l’adresse relue', async () => {
    const user = await makeUser()
    const job = await request()

    expect(await runJobNow(job.id)).toBe(true)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0]?.[0]?.to).toBe(EMAIL)

    // Le lien porte un jeton que la vérification accepte : c'est la preuve que
    // le jeton créé par le travail est bien celui qui part.
    const found = await lookupPasswordReset(tokenFromLastSend())
    expect(found).toEqual({
      ok: true,
      userId: user.id,
      tokenId: expect.any(String),
    })
  })

  it('marque le travail terminé, pour que le cron ne renvoie pas un second lien', async () => {
    await makeUser()
    const job = await request()

    await runJobNow(job.id)

    const done = await prisma.job.findUnique({
      where: { id: job.id },
      select: { completedAt: true },
    })
    expect(done?.completedAt).not.toBeNull()

    // Le passage du cron ne doit RIEN renvoyer. Sans le marquage, la personne
    // recevrait deux liens — et le premier, invalidé par le second, la mènerait
    // à « ce lien n'est plus valide » sur un message qu'elle vient d'ouvrir.
    await runJobs(new Date(), 2_000)
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('refuse une seconde prise du même travail', async () => {
    await makeUser()
    const job = await request()

    expect(await runJobNow(job.id)).toBe(true)
    // La prise est un UPDATE conditionnel : le second appel ne trouve plus rien
    // à prendre. C'est ce qui départage le cron et la poussée immédiate quand
    // ils tombent au même instant.
    expect(await runJobNow(job.id)).toBe(false)
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })
})

describe('les cas où il ne faut rien envoyer', () => {
  it('n’envoie rien si le compte a été effacé entre la demande et l’envoi', async () => {
    const user = await makeUser()
    const job = await request()

    // La fenêtre est réelle : la demande et l'envoi ne sont plus le même geste.
    await prisma.user.update({
      where: { id: user.id },
      data: { anonymizedAt: new Date() },
    })

    await runJobNow(job.id)

    expect(sendSpy).not.toHaveBeenCalled()

    // Et surtout : aucun jeton posé. Poser un lien de réinitialisation sur une
    // ligne anonymisée la ferait revivre.
    const tokens = await prisma.userToken.count({ where: { userId: user.id } })
    expect(tokens).toBe(0)
  })

  it('remet le travail en file si l’envoi échoue, au lieu de perdre la personne dehors', async () => {
    await makeUser()
    const job = await request()

    sendSpy.mockImplementation(async () => {
      throw new Error('prestataire indisponible')
    })

    expect(await runJobNow(job.id)).toBe(false)

    const retried = await prisma.job.findUnique({
      where: { id: job.id },
      select: { completedAt: true, attempts: true, runAt: true, lastError: true },
    })

    // C'est le gain de fiabilité qui accompagne le déplacement : avant, un
    // prestataire indisponible trente secondes donnait « consultez votre
    // boîte », aucun e-mail, et une personne enfermée dehors sans recours.
    expect(retried?.completedAt).toBeNull()
    expect(retried?.attempts).toBe(1)
    expect(retried?.lastError).toContain('prestataire indisponible')
    expect(retried?.runAt.getTime()).toBeGreaterThan(Date.now())
  })
})
