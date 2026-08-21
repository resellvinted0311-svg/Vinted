import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import { anonymizeUser, eraseAccount } from '@/lib/privacy/anonymize'
import { exportPersonalData } from '@/lib/privacy/export'
import { purgeExpiredPersonalData } from '@/lib/privacy/retention'
import { INACTIVE_ACCOUNT_RETENTION_DAYS } from '@/lib/config/privacy'

/**
 * Droits des personnes, contre une vraie base.
 *
 * Ce qui est vérifié ici ne se simule pas : la question est de savoir ce qui
 * reste RÉELLEMENT en base après un effacement — y compris ce que les
 * cascades du schéma emportent sans qu'on le leur demande, et ce qu'elles
 * n'emportent pas alors qu'on le croyait.
 */

const PREFIX = 'rgpd-test-'

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: PREFIX } },
        { email: { contains: '@anonymise.invalid' } },
      ],
    },
    select: { id: true },
  })
  const ids = users.map((u) => u.id)

  if (ids.length > 0) {
    await prisma.orderItem.deleteMany({
      where: { order: { userId: { in: ids } } },
    })
    await prisma.order.deleteMany({ where: { userId: { in: ids } } })
    await prisma.userToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }

  await prisma.guestFavorite.deleteMany({
    where: { sessionToken: { startsWith: PREFIX } },
  })
  await prisma.cart.deleteMany({
    where: { sessionToken: { startsWith: PREFIX } },
  })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeUser(suffix: string, lastSeenAt: Date | null = new Date()) {
  return prisma.user.create({
    data: {
      email: `${PREFIX}${suffix}@exemple.fr`,
      passwordHash: '$argon2id$factice',
      firstName: 'Nina',
      lastName: 'Exemple',
      marketingConsent: true,
      marketingConsentAt: new Date(),
      lastSeenAt,
    },
    select: { id: true },
  })
}

async function makeOrder(userId: string, suffix: string) {
  return prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      userId,
      email: `${PREFIX}${suffix}@exemple.fr`,
      locale: 'fr',
      subtotalCents: 2000,
      shippingCents: 500,
      totalCents: 2500,
      shippingAddress: { lastName: 'Exemple', city: 'Lille' },
      billingAddress: { lastName: 'Exemple', city: 'Lille' },
      shippingCarrierCode: 'mock',
      shippingServiceCode: 'standard',
      customerNote: 'Sonner deux fois',
    },
    select: { id: true },
  })
}

describe('effacement d’un compte', () => {
  it('supprime réellement le compte quand aucune commande n’existe', async () => {
    const user = await makeUser('sans-commande')

    const result = await eraseAccount(user.id)

    expect(result.outcome).toBe('deleted')
    expect(
      await prisma.user.findUnique({ where: { id: user.id } }),
    ).toBeNull()
  })

  it('conserve la pièce comptable et vide l’identité quand une commande existe', async () => {
    const user = await makeUser('avec-commande')
    await makeOrder(user.id, 'cmd-1')

    const result = await eraseAccount(user.id)

    expect(result).toEqual({ outcome: 'anonymized', retainedOrders: 1 })

    // La commande survit : dix ans, article L123-22 du code de commerce.
    const order = await prisma.order.findFirstOrThrow({
      where: { userId: user.id },
      select: {
        totalCents: true,
        email: true,
        customerNote: true,
        billingAddress: true,
      },
    })
    expect(order.totalCents).toBe(2500)
    expect(order.billingAddress).toEqual({ lastName: 'Exemple', city: 'Lille' })

    // …mais ce que la facture n'exige pas s'en va.
    expect(order.email).not.toContain('exemple.fr')
    expect(order.customerNote).toBeNull()
  })

  it('ne laisse aucune donnée personnelle sur la ligne conservée', async () => {
    const user = await makeUser('identite')
    await makeOrder(user.id, 'cmd-2')

    await eraseAccount(user.id)

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        marketingConsent: true,
        marketingConsentAt: true,
        anonymizedAt: true,
      },
    })

    expect(after.firstName).toBeNull()
    expect(after.lastName).toBeNull()
    expect(after.passwordHash).toBeNull()
    expect(after.marketingConsent).toBe(false)
    expect(after.marketingConsentAt).toBeNull()
    expect(after.anonymizedAt).not.toBeNull()

    // Domaine réservé par la RFC 2606 : ne peut ni exister ni être routé.
    expect(after.email).toMatch(/@anonymise\.invalid$/)
  })

  it('emporte les jetons, qu’aucune cascade ne couvre', async () => {
    const user = await makeUser('jetons')
    await makeOrder(user.id, 'cmd-3')
    await prisma.userToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: `${PREFIX}jeton`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    await eraseAccount(user.id)

    // UserToken n'a pas de relation Prisma vers User : aucune cascade ne
    // l'emporte. Un jeton de réinitialisation survivant à l'effacement
    // rouvrirait un compte censé ne plus exister.
    expect(
      await prisma.userToken.count({ where: { userId: user.id } }),
    ).toBe(0)
  })

  it('est rejouable sans effet de bord', async () => {
    const user = await makeUser('idempotent')
    await makeOrder(user.id, 'cmd-4')

    await anonymizeUser(user.id)
    const first = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { anonymizedAt: true },
    })

    await anonymizeUser(user.id)
    const second = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { anonymizedAt: true },
    })

    expect(second.anonymizedAt).toEqual(first.anonymizedAt)
  })
})

describe('export des données', () => {
  it('donne une copie complète sans jamais livrer l’empreinte du mot de passe', async () => {
    const user = await makeUser('export')
    await makeOrder(user.id, 'cmd-5')

    const data = await exportPersonalData(user.id)
    const serialized = JSON.stringify(data)

    expect(data?.orders).toHaveLength(1)
    expect(serialized).toContain('Nina')
    expect(serialized).not.toContain('passwordHash')
    expect(serialized).not.toContain('argon2')
    // Les coûts d'achat sont des données de l'entreprise, pas de la personne.
    expect(serialized).not.toContain('costCentsSnapshot')
  })
})

describe('purge périodique', () => {
  it('efface les sessions et jetons périmés', async () => {
    const user = await makeUser('purge-sessions')
    const past = new Date(Date.now() - 86_400_000)

    await prisma.session.create({
      data: { sessionToken: `${PREFIX}session`, userId: user.id, expires: past },
    })
    await prisma.userToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: `${PREFIX}perime`,
        expiresAt: past,
      },
    })

    const report = await purgeExpiredPersonalData()

    expect(report.expiredSessions).toBeGreaterThanOrEqual(1)
    expect(report.expiredUserTokens).toBeGreaterThanOrEqual(1)
    expect(
      await prisma.session.count({ where: { userId: user.id } }),
    ).toBe(0)
  })

  it('efface les favoris de visiteur plus vieux que leur cookie', async () => {
    const article = await prisma.article.findFirstOrThrow({ select: { id: true } })

    await prisma.guestFavorite.create({
      data: {
        sessionToken: `${PREFIX}vieux`,
        articleId: article.id,
        createdAt: new Date(Date.now() - 60 * 86_400_000),
      },
    })
    await prisma.guestFavorite.create({
      data: { sessionToken: `${PREFIX}recent`, articleId: article.id },
    })

    await purgeExpiredPersonalData()

    // Passé la durée de vie du cookie, plus personne ne peut les retrouver —
    // pas même la personne concernée.
    expect(
      await prisma.guestFavorite.count({
        where: { sessionToken: `${PREFIX}vieux` },
      }),
    ).toBe(0)
    expect(
      await prisma.guestFavorite.count({
        where: { sessionToken: `${PREFIX}recent` },
      }),
    ).toBe(1)
  })

  it('anonymise un compte inactif sans toucher à un compte actif', async () => {
    const longAgo = new Date(
      Date.now() - (INACTIVE_ACCOUNT_RETENTION_DAYS + 1) * 86_400_000,
    )
    const dormant = await makeUser('dormant', longAgo)
    const active = await makeUser('actif')

    await purgeExpiredPersonalData()

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: dormant.id },
      select: { anonymizedAt: true, firstName: true },
    })
    expect(after.anonymizedAt).not.toBeNull()
    expect(after.firstName).toBeNull()

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: active.id },
      select: { anonymizedAt: true, firstName: true },
    })
    expect(untouched.anonymizedAt).toBeNull()
    expect(untouched.firstName).toBe('Nina')
  })

  it('n’oublie pas un compte créé puis jamais réutilisé', async () => {
    // `lastSeenAt` est nul : sans repli sur la date de création, ces
    // comptes-là ne seraient jamais purgés — l'inverse du but recherché.
    const longAgo = new Date(
      Date.now() - (INACTIVE_ACCOUNT_RETENTION_DAYS + 1) * 86_400_000,
    )
    const never = await prisma.user.create({
      data: {
        email: `${PREFIX}jamais-revenu@exemple.fr`,
        firstName: 'Diego',
        lastSeenAt: null,
        createdAt: longAgo,
      },
      select: { id: true },
    })

    await purgeExpiredPersonalData()

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: never.id },
      select: { anonymizedAt: true },
    })
    expect(after.anonymizedAt).not.toBeNull()
  })
})
