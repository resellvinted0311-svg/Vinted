import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import {
  openPasswordReset,
  lookupPasswordReset,
  consumePasswordReset,
  tokensMatch,
  RESET_TTL_MINUTES,
} from '@/lib/auth/password-reset'
import { verifyPassword } from '@/lib/auth/password'
import { anonymizeUser } from '@/lib/privacy/anonymize'
import { purgeExpiredPersonalData } from '@/lib/privacy/retention'

/**
 * La réinitialisation de mot de passe, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce mécanisme mérite autant de tests
 * ---------------------------------------------------------------------------
 * Un lien de réinitialisation est une clé du compte, envoyée par un canal qu'on
 * ne maîtrise pas, à quelqu'un qu'on n'a pas authentifié. Chacune des
 * protections ci-dessous répond à une façon connue de rater cela : le jeton en
 * clair en base, le jeton réutilisable, le jeton éternel, le jeton qui ressuscite
 * un compte effacé, et surtout les sessions de l'intrus qu'on laisse vivre après
 * que la personne a « repris la main ».
 */

const EMAIL = 'reinit@nina-diego.test'
const OLD_PASSWORD = 'ancien-mot-de-passe-long'
const NEW_PASSWORD = 'nouveau-mot-de-passe-long'

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { contains: 'reinit' } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  if (ids.length > 0) {
    await prisma.userToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { contains: 'reinit' } } })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

/** Promesse dénouée de l'extérieur, pour entrelacer deux transactions à la main. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function makeUser(suffix = ''): Promise<{ id: string; email: string }> {
  const { hashPassword } = await import('@/lib/auth/password')
  const email = suffix ? `reinit-${suffix}@nina-diego.test` : EMAIL

  return prisma.user.create({
    data: {
      email,
      locale: 'fr',
      passwordHash: await hashPassword(OLD_PASSWORD),
    },
    select: { id: true, email: true },
  })
}

describe('ouverture d’une réinitialisation', () => {
  it('n’écrit JAMAIS le jeton en clair', async () => {
    const user = await makeUser()

    const request = await openPasswordReset(user.id, 'fr')

    const rows = await prisma.userToken.findMany({
      where: { userId: user.id },
      select: { tokenHash: true, type: true, usedAt: true },
    })

    expect(rows).toHaveLength(1)
    // `UserToken` est une liste de clés d'accès à des comptes. Une lecture
    // seule de la base — sauvegarde égarée, réplica mal configuré, export de
    // débogage — ouvrirait toutes les réinitialisations en cours.
    expect(rows[0]!.tokenHash).not.toBe(request.token)
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]!.type).toBe('password-reset')
    expect(rows[0]!.usedAt).toBeNull()
  })

  it('date l’échéance à trente minutes', async () => {
    const user = await makeUser()
    const now = new Date('2026-08-25T10:00:00.000Z')

    const request = await openPasswordReset(user.id, 'fr', now)

    // Un lien de réinitialisation vit dans une boîte de réception, parfois
    // consultée sur un poste partagé. Vingt-quatre heures d'ouverture pour un
    // geste qui se fait en deux minutes n'achètent aucun confort.
    expect(request.expiresAt.getTime() - now.getTime()).toBe(
      RESET_TTL_MINUTES * 60_000,
    )
  })

  it('compose un lien vers la boutique, dans la bonne langue', async () => {
    const user = await makeUser()
    const request = await openPasswordReset(user.id, 'de')

    expect(request.url).toContain('/de/connexion/mot-de-passe/')
    expect(request.url).toContain(request.token)
  })

  it('invalide le jeton précédent', async () => {
    // Sans cela, chaque demande ajoute une clé vivante au trousseau. Trois
    // clics sur « mot de passe oublié » laisseraient trois liens ouverts
    // pendant une demi-heure, dans trois messages qu'on ne relira pas.
    const user = await makeUser()

    const first = await openPasswordReset(user.id, 'fr')
    const second = await openPasswordReset(user.id, 'fr')

    expect((await lookupPasswordReset(first.token)).ok).toBe(false)
    expect((await lookupPasswordReset(second.token)).ok).toBe(true)
  })
})

describe('vérification d’un lien', () => {
  it('accepte un jeton frais', async () => {
    const user = await makeUser()
    const request = await openPasswordReset(user.id, 'fr')

    const found = await lookupPasswordReset(request.token)

    expect(found).toEqual({
      ok: true,
      userId: user.id,
      tokenId: expect.any(String),
    })
  })

  it('n’écrit RIEN — ouvrir le lien ne le consomme pas', async () => {
    // Le défaut évité frappe des gens parfaitement légitimes : les filtres
    // antivirus des messageries d'entreprise suivent les liens entrants pour
    // les inspecter. Un jeton consommé à l'ouverture serait brûlé avant que la
    // personne n'ait cliqué.
    const user = await makeUser()
    const request = await openPasswordReset(user.id, 'fr')

    await lookupPasswordReset(request.token)
    await lookupPasswordReset(request.token)
    await lookupPasswordReset(request.token)

    const row = await prisma.userToken.findFirstOrThrow({
      where: { userId: user.id },
      select: { usedAt: true },
    })
    expect(row.usedAt).toBeNull()
    expect((await lookupPasswordReset(request.token)).ok).toBe(true)
  })

  it('refuse un jeton inventé', async () => {
    expect(await lookupPasswordReset('jeton-qui-n-existe-pas')).toEqual({
      ok: false,
      reason: 'unknown',
    })
  })

  it('refuse un jeton échu', async () => {
    const user = await makeUser()
    const now = new Date('2026-08-25T10:00:00.000Z')
    const request = await openPasswordReset(user.id, 'fr', now)

    const later = new Date(now.getTime() + (RESET_TTL_MINUTES + 1) * 60_000)
    expect(await lookupPasswordReset(request.token, later)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('ne reconnaît pas un jeton d’un caractère près', async () => {
    const user = await makeUser()
    const request = await openPasswordReset(user.id, 'fr')

    const tampered = `${request.token.slice(0, -1)}${
      request.token.at(-1) === 'A' ? 'B' : 'A'
    }`

    expect(tokensMatch(request.token, tampered)).toBe(false)
    expect((await lookupPasswordReset(tampered)).ok).toBe(false)
  })
})

describe('consommation du lien', () => {
  it('pose le nouveau mot de passe et invalide l’ancien', async () => {
    const user = await makeUser()
    const request = await openPasswordReset(user.id, 'fr')

    const outcome = await consumePasswordReset(request.token, NEW_PASSWORD)
    // L'adresse est remontée : sans elle, `resetPasswordAction` ne peut pas
    // appeler `adoptGuestSession`, qui exige les DEUX concordances — le jeton
    // du navigateur ET l'adresse. C'est ce qui rattache le panier, les favoris
    // et surtout le prix négocié laissés avant la réinitialisation.
    expect(outcome).toEqual({ ok: true, userId: user.id, email: user.email })

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    })

    expect(await verifyPassword(after.passwordHash, NEW_PASSWORD)).toBe(true)
    expect(await verifyPassword(after.passwordHash, OLD_PASSWORD)).toBe(false)
  })

  it('ferme TOUTES les autres sessions', async () => {
    // Le point le plus important, et celui qu'on oublie le plus souvent. On
    // réinitialise un mot de passe parce qu'on l'a oublié — ou parce qu'on
    // soupçonne quelqu'un d'autre de l'avoir. Dans le second cas, laisser
    // vivre les sessions ouvertes rend le geste inutile : l'intrus reste
    // connecté APRÈS que la personne a « repris la main ».
    const user = await makeUser()
    await prisma.session.createMany({
      data: [
        {
          userId: user.id,
          sessionToken: 'session-intruse-1',
          expires: new Date(Date.now() + 86_400_000),
        },
        {
          userId: user.id,
          sessionToken: 'session-intruse-2',
          expires: new Date(Date.now() + 86_400_000),
        },
      ],
    })

    const request = await openPasswordReset(user.id, 'fr')
    await consumePasswordReset(request.token, NEW_PASSWORD)

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
  })

  it('ne sert qu’une fois', async () => {
    const user = await makeUser()
    const request = await openPasswordReset(user.id, 'fr')

    expect((await consumePasswordReset(request.token, NEW_PASSWORD)).ok).toBe(true)

    // Un double envoi du formulaire, ou un onglet resté ouvert. Sans le
    // prédicat `usedAt IS NULL`, le second écraserait le premier : la personne
    // aurait choisi un mot de passe et s'en verrait attribuer un autre.
    const second = await consumePasswordReset(request.token, 'un-troisieme-mot-de-passe')
    expect(second).toEqual({ ok: false, reason: 'used' })

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    expect(await verifyPassword(after.passwordHash, NEW_PASSWORD)).toBe(true)
  })

  it('ne pose rien si le jeton est consommé pendant l’envoi', async () => {
    // ------------------------------------------------------------------
    // Le test qui manquait, et pourquoi le précédent ne suffisait pas
    // ------------------------------------------------------------------
    // « Ne sert qu'une fois » est SÉQUENTIEL : la première consommation a
    // commité avant que la seconde ne lise, donc `lookupPasswordReset` refuse
    // dès la lecture et l'écriture n'est jamais tentée. Vérifié par mutation :
    // retirer le prédicat `usedAt: null` de l'UPDATE laissait ce test-là vert.
    // Il mesurait le garde de LECTURE, pas celui de la base.
    //
    // Ici, une transaction tierce tient le verrou de ligne pendant que la
    // consommation lit ; elle marque le jeton utilisé et commite pendant que
    // la consommation est bloquée sur son UPDATE. Au réveil, en lecture
    // validée, PostgreSQL réévalue la clause : `usedAt IS NULL` ne correspond
    // plus.
    //
    // Sans le prédicat, deux envois du formulaire poseraient deux mots de
    // passe : la personne aurait choisi le premier et se verrait attribuer le
    // second, sans rien qui l'explique.
    const user = await makeUser('course')
    const request = await openPasswordReset(user.id, 'fr')
    const found = await lookupPasswordReset(request.token)
    if (!found.ok) throw new Error('jeton attendu valide')

    const verrouPris = deferred()
    const laisserPasser = deferred()

    const intruse = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "UserToken" WHERE "id" = ${found.tokenId} FOR UPDATE`
        verrouPris.resolve()
        await laisserPasser.promise
        await tx.$executeRaw`UPDATE "UserToken" SET "usedAt" = now() WHERE "id" = ${found.tokenId}`
      },
      { timeout: 15_000 },
    )

    await verrouPris.promise

    // `hashPassword` prend des centaines de millisecondes avant même
    // d'ouvrir la transaction : la lecture est donc largement passée quand
    // l'UPDATE vient buter sur le verrou.
    const bloquee = consumePasswordReset(request.token, NEW_PASSWORD)

    await new Promise((resolve) => setTimeout(resolve, 600))
    laisserPasser.resolve()
    await intruse

    expect(await bloquee).toEqual({ ok: false, reason: 'used' })

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    expect(
      await verifyPassword(after.passwordHash, NEW_PASSWORD),
      'aucun mot de passe ne doit avoir été posé',
    ).toBe(false)
    expect(await verifyPassword(after.passwordHash, OLD_PASSWORD)).toBe(true)
  })

  it('refuse un jeton échu, sans rien changer', async () => {
    const user = await makeUser()
    const now = new Date('2026-08-25T10:00:00.000Z')
    const request = await openPasswordReset(user.id, 'fr', now)

    const later = new Date(now.getTime() + (RESET_TTL_MINUTES + 1) * 60_000)
    expect(await consumePasswordReset(request.token, NEW_PASSWORD, later)).toEqual({
      ok: false,
      reason: 'expired',
    })

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    })
    expect(await verifyPassword(after.passwordHash, OLD_PASSWORD)).toBe(true)
  })

  it('ne ressuscite pas un compte effacé', async () => {
    // Un jeton de vérification survivant avait déjà produit ce défaut une fois
    // dans ce projet : un lien magique périmé RECRÉAIT le compte supprimé.
    // Ici la ligne `User` survit à l'anonymisation — obligation comptable —
    // donc rien n'empêcherait d'y reposer un mot de passe.
    const user = await makeUser('efface')
    const request = await openPasswordReset(user.id, 'fr')

    await anonymizeUser(user.id)

    const outcome = await consumePasswordReset(request.token, NEW_PASSWORD)
    // L'effacement supprime aussi les jetons : le refus tombe donc en amont,
    // ce qui est encore mieux que le garde-fou de la transaction.
    expect(outcome.ok).toBe(false)

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, anonymizedAt: true },
    })
    expect(after.passwordHash).toBeNull()
    expect(after.anonymizedAt).not.toBeNull()
  })
})

describe('cycle de vie de la ligne', () => {
  it('est emportée par l’effacement du compte', async () => {
    const user = await makeUser('purge')
    await openPasswordReset(user.id, 'fr')

    await anonymizeUser(user.id)

    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(0)
  })

  it('est emportée par la purge une fois échue', async () => {
    // La table était purgée et effacée depuis toujours — et écrite par rien.
    // Maintenant qu'elle l'est, on vérifie que les deux chemins se rejoignent.
    const user = await makeUser('echue')
    const past = new Date('2020-01-01T00:00:00.000Z')
    await openPasswordReset(user.id, 'fr', past)

    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(1)

    await purgeExpiredPersonalData()

    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(0)
  })
})
