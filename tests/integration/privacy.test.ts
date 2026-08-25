import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  anonymizeUser,
  eraseAccount,
} from '@/lib/privacy/anonymize'
import { exportPersonalData } from '@/lib/privacy/export'
import { purgeExpiredPersonalData } from '@/lib/privacy/retention'
import { MAX_ATTEMPTS } from '@/lib/jobs/queue'
import {
  ABANDONED_ORDER_RETENTION_DAYS,
  GUEST_DATA_RETENTION_DAYS,
  ACCOUNTING_RETENTION_DAYS,
  INACTIVE_ACCOUNT_RETENTION_DAYS,
  WEBHOOK_EVENT_RETENTION_DAYS,
  AUDIT_LOG_RETENTION_DAYS,
  PROCESSING_REGISTER,
} from '@/lib/config/privacy'

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

  // Les commandes d'un visiteur n'ont pas de compte : elles ne sont pas
  // emportées par le nettoyage ci-dessus.
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  })

  // Les traces d'audit ne sont rattachées à aucun compte : ni la cascade du
  // schéma ni le nettoyage ci-dessus ne les emporte. Sans cette ligne, elles
  // s'accumulaient d'une exécution à l'autre et faisaient échouer l'assertion
  // de comptage de la purge — constaté.
  await prisma.auditLog.deleteMany({
    where: { entityId: { startsWith: PREFIX } },
  })

  await prisma.webhookEvent.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  })
  await prisma.job.deleteMany({
    where: { payload: { path: ['test'], equals: PREFIX } },
  })

  await prisma.offer.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.verificationToken.deleteMany({
    where: { identifier: { startsWith: PREFIX } },
  })

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

/**
 * Un tunnel de commande abandonné : jamais payé, aucune facture, mais des
 * coordonnées complètes — c'est le cas le plus fréquent d'un site marchand.
 */
async function makeAbandonedOrder(
  suffix: string,
  createdAt: Date,
  sessionToken = `${PREFIX}jeton-${suffix}`,
) {
  return prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      userId: null,
      lockOwnerId: sessionToken,
      email: `${PREFIX}${suffix}@exemple.fr`,
      locale: 'fr',
      status: 'PENDING_PAYMENT',
      subtotalCents: 2000,
      shippingCents: 500,
      totalCents: 2500,
      shippingAddress: {
        firstName: 'Nina',
        lastName: 'Exemple',
        line1: '12 rue du Registre',
        postalCode: '59000',
        city: 'Lille',
        country: 'FR',
        phone: '0600000000',
      },
      billingAddress: { lastName: 'Exemple', city: 'Lille' },
      shippingCarrierCode: 'mock',
      shippingServiceCode: 'relais',
      servicePointId: 'PR-12345',
      customerNote: 'Interphone au fond de la cour',
      createdAt,
    },
    select: { id: true },
  })
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
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
  it('n’omet pas le panier, pourtant déclaré au registre', async () => {
    // Une omission dans l'export fait mentir la déclaration : le registre
    // annonce que le panier est conservé, et l'article 15 demande une copie de
    // TOUT ce qui est détenu — y compris ce qui paraît sans intérêt.
    const user = await makeUser('panier')
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
    const article = await prisma.article.create({
      data: {
        sku: `${PREFIX}art`,
        slug: `${PREFIX}art`,
        condition: 'GOOD',
        sizeLabel: 'M',
        sizeNormalized: 'M',
        priceCents: 1800,
        costCents: 500,
        floorPriceCents: 900,
        weightGrams: 300,
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        categoryId: category.id,
      },
      select: { id: true },
    })
    await prisma.cart.create({
      data: {
        userId: user.id,
        sessionToken: `${PREFIX}cart-export`,
        items: {
          create: {
            articleId: article.id,
            unitPriceCents: 1800,
            priceSource: 'LIST',
          },
        },
      },
    })

    const data = await exportPersonalData(user.id)

    expect(data?.cart).toHaveLength(1)
    expect(JSON.stringify(data?.cart)).toContain(`${PREFIX}art`)

    await prisma.cart.deleteMany({ where: { userId: user.id } })
    await prisma.article.delete({ where: { id: article.id } })
  })

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

describe('tunnels de commande abandonnés', () => {
  it('vide les coordonnées d’une commande jamais payée', async () => {
    // Le défaut d'origine : la purge écartait la table `Order` EN BLOC au motif
    // que les factures s'y trouvent. Un tunnel abandonné — nom, rue, code
    // postal, ville, téléphone, adresse e-mail — n'était donc purgé par rien,
    // indéfiniment. Ce n'est pas une pièce comptable : aucun paiement, aucune
    // facture, aucun exercice ne la porte.
    const order = await makeAbandonedOrder(
      'abandon',
      daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 1),
    )

    const report = await purgeExpiredPersonalData()
    expect(report.anonymizedAbandonedOrders).toBeGreaterThanOrEqual(1)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        email: true,
        customerNote: true,
        lockOwnerId: true,
        shippingAddress: true,
        billingAddress: true,
        servicePointId: true,
      },
    })

    // Plus rien ne désigne personne.
    expect(after.email).not.toContain('exemple.fr')
    expect(after.customerNote).toBeNull()
    expect(after.lockOwnerId).toBeNull()
    expect(after.servicePointId).toBeNull()
    expect(after.shippingAddress).toEqual({})
    expect(after.billingAddress).toEqual({})

    // Et on le vérifie sur le contenu sérialisé, pas seulement clé par clé :
    // une adresse laissée dans un sous-objet ne se voit pas autrement.
    const serialized = JSON.stringify(after)
    expect(serialized).not.toContain('rue du Registre')
    expect(serialized).not.toContain('0600000000')
    expect(serialized).not.toContain('59000')
    expect(serialized).not.toContain('Interphone')
  })

  it('garde la trace de l’abandon : montants, dates, numéro', async () => {
    // On vide, on ne supprime pas. Un paiement a PU aboutir sans que le webhook
    // nous parvienne : détruire la ligne effacerait la seule trace d'un débit
    // à retrouver, au moment précis où elle servirait.
    const order = await makeAbandonedOrder(
      'trace',
      daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 1),
    )

    await purgeExpiredPersonalData()

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { orderNumber: true, totalCents: true, status: true },
    })
    expect(after.orderNumber).toBe(`${PREFIX}trace`)
    expect(after.totalCents).toBe(2500)
  })

  it('ne touche pas une commande abandonnée RÉCENTE', async () => {
    // Quelqu'un qu'on interrompt au moment de payer doit pouvoir revenir.
    const order = await makeAbandonedOrder('recent', daysAgo(1))

    await purgeExpiredPersonalData()

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { email: true, customerNote: true },
    })
    expect(after.email).toContain('exemple.fr')
    expect(after.customerNote).toBe('Interphone au fond de la cour')
  })

  it('ne touche JAMAIS une commande payée, si ancienne soit-elle', async () => {
    // L'erreur symétrique, et la plus grave : purger une pièce comptable.
    // Dix ans, article L123-22 du code de commerce.
    const order = await makeAbandonedOrder(
      'payee',
      daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 400),
    )
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 399),
        invoiceNumber: `${PREFIX}FA-1`,
      },
    })

    await purgeExpiredPersonalData()

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { email: true, shippingAddress: true, invoiceNumber: true },
    })
    expect(after.email).toContain('exemple.fr')
    expect(JSON.stringify(after.shippingAddress)).toContain('rue du Registre')
    expect(after.invoiceNumber).toBe(`${PREFIX}FA-1`)
  })

  it('ne touche pas une commande ANNULÉE APRÈS paiement', async () => {
    // `CANCELLED` recouvre deux réalités opposées : un tunnel abandonné et une
    // vente annulée après encaissement. Seule la date de paiement les
    // distingue — c'est pour cela que le prédicat porte sur `paidAt`, pas sur
    // le statut.
    const order = await makeAbandonedOrder(
      'annulee',
      daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 10),
    )
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        paidAt: daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 9),
        cancelledAt: daysAgo(1),
      },
    })

    await purgeExpiredPersonalData()

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { email: true },
    })
    expect(after.email).toContain('exemple.fr')
  })

  it('vide une commande payée dont les dix ans sont écoulés', async () => {
    // Cette branche ne s'exécutera pas avant dix ans. Ce n'est pas une raison
    // de ne pas la vérifier : c'en est une de la vérifier maintenant, parce
    // que dans dix ans personne ne se souviendra qu'elle existe.
    const order = await makeAbandonedOrder(
      'echu',
      daysAgo(ACCOUNTING_RETENTION_DAYS + 40),
    )
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: daysAgo(ACCOUNTING_RETENTION_DAYS + 30),
        invoiceNumber: `${PREFIX}FA-echu`,
      },
    })

    const report = await purgeExpiredPersonalData()
    expect(report.anonymizedExpiredOrders).toBeGreaterThanOrEqual(1)

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        email: true,
        shippingAddress: true,
        customerNote: true,
        invoiceNumber: true,
        totalCents: true,
      },
    })
    expect(after.email).not.toContain('exemple.fr')
    expect(after.shippingAddress).toEqual({})
    expect(after.customerNote).toBeNull()
    // La ligne comptable survit : la suite des numéros reste continue.
    expect(after.invoiceNumber).toBe(`${PREFIX}FA-echu`)
    expect(after.totalCents).toBe(2500)
  })

  it('ne touche pas une commande payée AVANT les dix ans', async () => {
    const order = await makeAbandonedOrder(
      'encours',
      daysAgo(ACCOUNTING_RETENTION_DAYS - 100),
    )
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: daysAgo(ACCOUNTING_RETENTION_DAYS - 100),
        invoiceNumber: `${PREFIX}FA-encours`,
      },
    })

    await purgeExpiredPersonalData()

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { email: true },
    })
    expect(after.email).toContain('exemple.fr')
  })

  it('est rejouable : le second passage ne trouve plus rien', async () => {
    await makeAbandonedOrder(
      'idempotent',
      daysAgo(ABANDONED_ORDER_RETENTION_DAYS + 1),
    )

    const premier = await purgeExpiredPersonalData()
    expect(premier.anonymizedAbandonedOrders).toBeGreaterThanOrEqual(1)

    const second = await purgeExpiredPersonalData()
    expect(second.anonymizedAbandonedOrders).toBe(0)
  })
})

describe('traces techniques', () => {
  it('efface une trace d’événement de paiement périmée', async () => {
    // Elle est déjà caviardée à l'écriture, mais une trace qui ne sert plus
    // n'a pas à survivre pour autant.
    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        externalId: `${PREFIX}vieux`,
        payload: { type: 'checkout.session.completed' },
        processedAt: new Date(),
        createdAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 1),
      },
    })
    await prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        externalId: `${PREFIX}recent`,
        payload: { type: 'checkout.session.completed' },
        processedAt: new Date(),
      },
    })

    const report = await purgeExpiredPersonalData()
    expect(report.webhookEvents).toBeGreaterThanOrEqual(1)

    const reste = await prisma.webhookEvent.findMany({
      where: { externalId: { startsWith: PREFIX } },
      select: { externalId: true },
    })
    expect(reste.map((e) => e.externalId)).toEqual([`${PREFIX}recent`])
  })

  it('efface un travail TERMINÉ, jamais un travail en échec', async () => {
    // Un travail en échec doit rester visible tant qu'il peut être repris ou
    // compris. Le purger effacerait la trace d'un e-mail jamais parti.
    await prisma.job.create({
      data: {
        type: 'order.confirmation',
        payload: { test: PREFIX, orderId: 'x' },
        runAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 2),
        completedAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 1),
      },
    })
    await prisma.job.create({
      data: {
        type: 'order.confirmation',
        payload: { test: PREFIX, orderId: 'y' },
        runAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 2),
        attempts: 5,
        lastError: 'prestataire indisponible',
      },
    })

    const report = await purgeExpiredPersonalData()
    expect(report.finishedJobs).toBeGreaterThanOrEqual(1)

    const reste = await prisma.job.findMany({
      where: { payload: { path: ['test'], equals: PREFIX } },
      select: { lastError: true },
    })
    expect(reste).toHaveLength(1)
    expect(reste[0]?.lastError).toBe('prestataire indisponible')
  })

  it('applique VRAIMENT ce que le registre annonce pour les favoris', async () => {
    // ------------------------------------------------------------------
    // Ce que ce test relie, et qu'aucun autre ne reliait
    // ------------------------------------------------------------------
    // Le registre annonçait TRENTE JOURS pour `Favorite` comme pour
    // `GuestFavorite`, sous une entrée unique. Or rien n'efface jamais les
    // favoris d'un COMPTE à cette échéance : ils vivent jusqu'à l'effacement du
    // compte, ou jusqu'à l'anonymisation pour inactivité — trois ans. La page
    // publique annonçait une durée cent fois plus courte que la réalité.
    //
    // Vérifier la déclaration seule ne l'aurait pas attrapé : elle était
    // cohérente avec elle-même. Ce test confronte la déclaration à ce que la
    // purge FAIT, en la faisant tourner.
    const article = await prisma.article.findFirstOrThrow({ select: { id: true } })
    const user = await prisma.user.create({
      data: { email: `${PREFIX}favoris@exemple.fr`, locale: 'fr' },
      select: { id: true },
    })

    const vieux = daysAgo(GUEST_DATA_RETENTION_DAYS + 30)
    await prisma.favorite.create({
      data: { userId: user.id, articleId: article.id, createdAt: vieux },
    })
    await prisma.guestFavorite.create({
      data: {
        sessionToken: `${PREFIX}jeton-favori`,
        articleId: article.id,
        createdAt: vieux,
      },
    })

    await purgeExpiredPersonalData()

    const duCompte = await prisma.favorite.count({ where: { userId: user.id } })
    const invite = await prisma.guestFavorite.count({
      where: { sessionToken: `${PREFIX}jeton-favori` },
    })

    // Le favori d'un compte SURVIT : on le retrouve à chaque connexion,
    // exactement comme le panier. Le purger casserait ce comportement.
    expect(duCompte).toBe(1)
    // Celui d'une visiteuse, non : il ne survit pas au cookie qui le retrouve.
    expect(invite).toBe(0)

    // Et la déclaration doit dire CELA, pas autre chose. C'est le lien qui
    // manquait : deux entrées distinctes, une par comportement réel.
    const compte = PROCESSING_REGISTER.find((p) => p.key === 'favorites')
    const sansCompte = PROCESSING_REGISTER.find((p) => p.key === 'favorites-guest')

    expect(compte?.tables).toEqual(['Favorite'])
    expect(
      compte?.retentionDays,
      'les favoris d’un compte ne sont purgés par rien : annoncer une échéance ' +
        'en jours serait faux',
    ).toBeNull()

    expect(sansCompte?.tables).toEqual(['GuestFavorite'])
    expect(sansCompte?.retentionDays).toBe(GUEST_DATA_RETENTION_DAYS)
  })

  it('emporte AUSSI la commande d’invitée que l’export a remise', async () => {
    // ------------------------------------------------------------------
    // L'asymétrie réparée, et pourquoi elle était grave
    // ------------------------------------------------------------------
    // Camille achète depuis son téléphone sans compte, puis ouvre un compte
    // depuis son ordinateur par lien magique — `emailVerified` est posé, mais
    // `handover` ne rattache rien : le jeton du téléphone n'est pas celui de
    // l'ordinateur.
    //
    // L'export lui remettait cette commande en entier. L'effacement, lui, ne
    // comptait que `userId` : il trouvait zéro commande, SUPPRIMAIT la ligne
    // `User`, et l'écran annonçait « votre compte a été supprimé ». La commande
    // d'invitée restait dix ans — nom, rue, ville, TÉLÉPHONE, note libre — et
    // plus aucun compte n'existait pour la relier à sa demande.
    const email = `${PREFIX}deux-appareils@exemple.fr`
    const user = await prisma.user.create({
      data: { email, locale: 'fr', emailVerified: new Date() },
      select: { id: true },
    })

    const article = await prisma.article.findFirstOrThrow({ select: { id: true } })
    await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}INVITEE-1`,
        // Le point du scénario : aucune liaison au compte.
        userId: null,
        email,
        locale: 'fr',
        status: 'PAID',
        paidAt: new Date(),
        subtotalCents: 2000,
        shippingCents: 490,
        totalCents: 2490,
        shippingAddress: { city: 'Lille', phone: '+33612345678' },
        billingAddress: { city: 'Lille' },
        shippingCarrierCode: 'mock',
        shippingServiceCode: 'standard',
        customerNote: 'laissez chez la voisine',
        items: {
          create: {
            articleId: article.id,
            titleSnapshot: 'Pull',
            imageSnapshot: '',
            unitPriceCents: 2000,
            costCentsSnapshot: 600,
          },
        },
      },
    })

    const outcome = await eraseAccount(user.id)

    // Une commande rattachable existe : la ligne `User` doit être CONSERVÉE et
    // vidée, jamais supprimée — sans quoi le lien disparaît avec elle.
    expect(outcome.outcome).toBe('anonymized')

    const after = await prisma.order.findFirstOrThrow({
      where: { orderNumber: `${PREFIX}INVITEE-1` },
      select: { email: true, customerNote: true, shippingAddress: true },
    })

    expect(after.email).not.toBe(email)
    expect(after.customerNote).toBeNull()
    // Le téléphone n'est aucune mention obligatoire de facture : il part.
    expect(JSON.stringify(after.shippingAddress)).not.toContain('+33612345678')
  })

  it('efface une trace d’audit dont la commande décrite est hors conservation', async () => {
    // `AuditLog` n'était purgée par RIEN. Une table qui ne se vide jamais finit
    // par tout garder, et celle-ci porte des identifiants de commandes et de
    // pièces — des identifiants indirects au sens de l'article 4.1.
    await prisma.auditLog.create({
      data: {
        action: 'order.unfulfillable_lines',
        entity: 'Order',
        entityId: `${PREFIX}-ancienne`,
        after: { articleIds: ['art_1'] },
        createdAt: daysAgo(AUDIT_LOG_RETENTION_DAYS + 1),
      },
    })
    await prisma.auditLog.create({
      data: {
        action: 'order.unfulfillable_lines',
        entity: 'Order',
        entityId: `${PREFIX}-recente`,
        after: { articleIds: ['art_2'] },
      },
    })

    const report = await purgeExpiredPersonalData()
    expect(report.auditEvents).toBeGreaterThanOrEqual(1)

    const reste = await prisma.auditLog.findMany({
      where: { entityId: { startsWith: PREFIX } },
      select: { entityId: true },
    })
    // La récente survit : la trace existe pour qu'une personne agisse dessus,
    // et l'effacer avant l'échéance de la commande la ferait disparaître au
    // moment où elle sert.
    expect(reste.map((row) => row.entityId)).toEqual([`${PREFIX}-recente`])
  })
})

// ---------------------------------------------------------------------------
// Les lacunes trouvées au second audit
// ---------------------------------------------------------------------------

/** Une pièce du catalogue, pour accrocher une négociation. */
async function makeArticle(suffix: string): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `${PREFIX}${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 3000,
      costCents: 800,
      floorPriceCents: 1500,
      weightGrams: 400,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })
  return article.id
}

/** Une offre déposée sans compte, ancienne. */
async function makeOldGuestOffer(articleId: string, suffix: string): Promise<string> {
  const offer = await prisma.offer.create({
    data: {
      articleId,
      guestEmail: `${PREFIX}${suffix}@exemple.fr`,
      guestSessionToken: `${PREFIX}jeton-${suffix}`,
      amountCents: 2400,
      status: 'ACCEPTED',
      expiresAt: daysAgo(GUEST_DATA_RETENTION_DAYS + 1),
      createdAt: daysAgo(GUEST_DATA_RETENTION_DAYS + 5),
    },
    select: { id: true },
  })
  return offer.id
}

describe('négociations sans compte, à l’échéance du cookie', () => {
  it('une offre d’un tunnel ABANDONNÉ est supprimée', async () => {
    // Le défaut : la condition disait « aucune ligne de commande », or
    // `OrderItem.offerId` est écrit dès la CRÉATION de la commande, avant tout
    // paiement. Une offre ayant seulement servi à afficher un prix dans un
    // tunnel abandonné sortait donc définitivement du champ de la purge —
    // pendant que la commande, elle, était consciencieusement vidée.
    const articleId = await makeArticle('abandon')
    const offerId = await makeOldGuestOffer(articleId, 'abandon')

    const order = await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}abandon`,
        email: `${PREFIX}abandon@exemple.fr`,
        locale: 'fr',
        status: 'PENDING_PAYMENT',
        subtotalCents: 2400,
        shippingCents: 0,
        totalCents: 2400,
        shippingAddress: { city: 'Lille' },
        billingAddress: {},
        shippingCarrierCode: 'mock',
        shippingServiceCode: 'standard',
        // JAMAIS payée : aucune pièce comptable ne s'y adosse.
        paidAt: null,
      },
      select: { id: true },
    })
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        articleId,
        offerId,
        titleSnapshot: 'Pièce',
        imageSnapshot: '',
        unitPriceCents: 2400,
        costCentsSnapshot: 800,
      },
    })

    await purgeExpiredPersonalData()

    expect(await prisma.offer.findUnique({ where: { id: offerId } })).toBeNull()
  })

  it('une offre ayant servi à une VENTE garde son montant, perd l’identité', async () => {
    // Elle justifie le prix porté sur une facture : la supprimer laisserait un
    // montant négocié inexplicable sur une pièce comptable. Mais l'adresse et
    // le jeton du navigateur n'ont rien à y faire — et rien ne les effaçait.
    const articleId = await makeArticle('vendue')
    const offerId = await makeOldGuestOffer(articleId, 'vendue')

    const order = await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}vendue`,
        email: `${PREFIX}vendue@exemple.fr`,
        locale: 'fr',
        status: 'PAID',
        paidAt: daysAgo(GUEST_DATA_RETENTION_DAYS + 2),
        invoiceNumber: `${PREFIX}F-1`,
        subtotalCents: 2400,
        shippingCents: 0,
        totalCents: 2400,
        shippingAddress: { city: 'Lille' },
        billingAddress: {},
        shippingCarrierCode: 'mock',
        shippingServiceCode: 'standard',
      },
      select: { id: true },
    })
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        articleId,
        offerId,
        titleSnapshot: 'Pièce',
        imageSnapshot: '',
        unitPriceCents: 2400,
        costCentsSnapshot: 800,
      },
    })

    await purgeExpiredPersonalData()

    const kept = await prisma.offer.findUnique({
      where: { id: offerId },
      select: { amountCents: true, guestEmail: true, guestSessionToken: true },
    })
    expect(kept).toEqual({
      amountCents: 2400,
      guestEmail: null,
      guestSessionToken: null,
    })
  })
})

describe('travaux différés définitivement en échec', () => {
  it('sont purgés comme les autres traces techniques', async () => {
    // « Un travail en échec doit rester visible tant qu'il PEUT être repris » —
    // mais `claimJobs` refuse au-delà du plafond. Un travail arrivé au bout de
    // ses tentatives n'était donc repris par personne, jamais marqué terminé,
    // et effacé par rien : une ligne désignant la commande d'une personne, et
    // le message d'erreur du prestataire, conservés pour toujours.
    await prisma.job.create({
      data: {
        type: 'order.confirmation',
        payload: { test: PREFIX, orderId: 'epuise' },
        runAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 2),
        createdAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 2),
        attempts: MAX_ATTEMPTS,
        lastError: 'prestataire indisponible',
      },
    })

    await purgeExpiredPersonalData()

    const reste = await prisma.job.findMany({
      where: { payload: { path: ['test'], equals: PREFIX } },
    })
    expect(reste).toHaveLength(0)
  })

  it('un travail encore reprenable est ÉPARGNÉ', async () => {
    // La frontière est le plafond, pas l'échec : tant qu'une reprise reste
    // promise, la trace sert à comprendre ce qui se passe.
    await prisma.job.create({
      data: {
        type: 'order.confirmation',
        payload: { test: PREFIX, orderId: 'reprenable' },
        runAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 2),
        createdAt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS + 2),
        attempts: MAX_ATTEMPTS - 1,
        lastError: 'prestataire indisponible',
      },
    })

    await purgeExpiredPersonalData()

    expect(
      await prisma.job.count({
        where: { payload: { path: ['test'], equals: PREFIX } },
      }),
    ).toBe(1)
  })
})

describe('ce que l’effacement du compte emportait pas', () => {
  it('efface les jetons de lien magique de l’adresse', async () => {
    // `VerificationToken` s'indexe sur l'ADRESSE, pas sur l'identifiant du
    // compte : aucune cascade ne la touche. Deux conséquences, dont la seconde
    // est la pire — un lien encore dans la boîte, cliqué après l'effacement,
    // RECRÉAIT un compte à cette adresse.
    const user = await makeUser('jetons')
    await prisma.verificationToken.create({
      data: {
        identifier: `${PREFIX}jetons@exemple.fr`,
        token: `${PREFIX}jeton-magique`,
        expires: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    await eraseAccount(user.id)

    expect(
      await prisma.verificationToken.count({
        where: { identifier: `${PREFIX}jetons@exemple.fr` },
      }),
    ).toBe(0)
  })

  it('efface aussi les jetons quand le compte est ANONYMISÉ', async () => {
    // La branche « des commandes existent » conserve la ligne `User` : sans
    // traitement explicite, rien n'emportait les jetons.
    const user = await makeUser('jetons-anon')
    await makeOrder(user.id, 'jetons-anon')
    await prisma.verificationToken.create({
      data: {
        identifier: `${PREFIX}jetons-anon@exemple.fr`,
        token: `${PREFIX}jeton-magique-2`,
        expires: new Date(Date.now() + 15 * 60 * 1000),
      },
    })

    const result = await eraseAccount(user.id)
    expect(result.outcome).toBe('anonymized')

    expect(
      await prisma.verificationToken.count({
        where: { identifier: `${PREFIX}jetons-anon@exemple.fr` },
      }),
    ).toBe(0)
  })

  it('emporte les négociations qui ne justifient aucune facture', async () => {
    const user = await makeUser('offres')
    const articleId = await makeArticle('compte')
    await prisma.offer.create({
      data: {
        articleId,
        userId: user.id,
        amountCents: 2400,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    })

    await eraseAccount(user.id)

    expect(await prisma.offer.count({ where: { articleId } })).toBe(0)
  })
})

describe('complétude de l’export', () => {
  it('contient le point relais, que l’effacement juge personnel', async () => {
    // Asymétrie corrigée : `anonymizeUser` EFFACE `servicePointId` au motif
    // qu'il n'est pas une mention obligatoire de facture — c'est un commerce à
    // quelques rues de chez soi. Une donnée qu'on juge assez personnelle pour
    // l'effacer doit figurer dans la copie qu'on remet.
    const user = await makeUser('relais')
    const order = await makeOrder(user.id, 'relais')
    await prisma.order.update({
      where: { id: order.id },
      data: { servicePointId: 'RELAIS-4242', paidAt: new Date() },
    })
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    })

    const dump = JSON.stringify(await exportPersonalData(user.id))
    expect(dump).toContain('RELAIS-4242')
  })
})
