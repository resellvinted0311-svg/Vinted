import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import { allocateInvoiceNumber, formatInvoiceNumber } from '@/lib/shop/invoice'
import { markOrderPaid } from '@/lib/shop/fulfilment'
import { enqueue, claimJobs, completeJob, failJob } from '@/lib/jobs/queue'
import { runJobs } from '@/lib/jobs/worker'

/**
 * Facturation et travaux différés, contre une vraie base.
 *
 * Deux propriétés ne se simulent pas : qu'une suite de numéros n'ait AUCUN
 * trou même quand une transaction échoue, et que deux exécutions concurrentes
 * du cron ne prennent pas le même travail.
 */

const PREFIX = 'INVJOB-'

async function cleanup(): Promise<void> {
  // Toute la file, pas seulement les travaux de ce fichier.
  //
  // `claimJobs` prend les travaux prêts de la table ENTIÈRE — c'est sa raison
  // d'être. Or les autres tests d'intégration marquent des commandes payées,
  // ce qui met en file de vraies confirmations ; elles survivent à la
  // suppression de leur commande, puisqu'un travail ne porte qu'un identifiant
  // dans son contenu JSON, sans clé étrangère.
  //
  // Ces travaux orphelins s'accumulaient d'une exécution à l'autre et
  // finissaient par remplir le lot de dix demandé ici : les assertions
  // passaient sur une base neuve et échouaient sur une base ayant déjà servi.
  // Les fichiers de test ne s'exécutent jamais en parallèle
  // (`fileParallelism: false`), vider la file est donc sans effet de bord.
  await prisma.job.deleteMany({})
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function currentCounter(): Promise<number> {
  const row = await prisma.counter.findUnique({ where: { key: 'invoice' } })
  return row?.value ?? 0
}

describe('numérotation des factures', () => {
  it('avance d’un en un', async () => {
    const before = await currentCounter()

    const first = await prisma.$transaction((tx) => allocateInvoiceNumber(tx))
    const second = await prisma.$transaction((tx) => allocateInvoiceNumber(tx))

    expect(first).toBe(formatInvoiceNumber(before + 1))
    expect(second).toBe(formatInvoiceNumber(before + 2))
  })

  it('ne laisse AUCUN trou quand une transaction échoue', async () => {
    // C'est toute la raison d'être du compteur plutôt que d'une séquence
    // PostgreSQL : `nextval` ne revient jamais en arrière, même sur un échec,
    // et un trou dans une suite de factures se présume comme une facture
    // détruite (article 242 nonies A de l'annexe II du CGI).
    const before = await currentCounter()

    await expect(
      prisma.$transaction(async (tx) => {
        await allocateInvoiceNumber(tx)
        throw new Error('vente interrompue')
      }),
    ).rejects.toThrow('vente interrompue')

    expect(await currentCounter()).toBe(before)

    const next = await prisma.$transaction((tx) => allocateInvoiceNumber(tx))
    // Le numéro qui aurait été perdu est bien réattribué.
    expect(next).toBe(formatInvoiceNumber(before + 1))
  })

  it('ne donne jamais deux fois le même numéro, même en concurrence', async () => {
    const before = await currentCounter()

    const numbers = await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.$transaction((tx) => allocateInvoiceNumber(tx)),
      ),
    )

    expect(new Set(numbers).size).toBe(8)
    expect(await currentCounter()).toBe(before + 8)
  })

  it('formate sur six chiffres', () => {
    expect(formatInvoiceNumber(1)).toBe('FA-000001')
    expect(formatInvoiceNumber(123456)).toBe('FA-123456')
  })
})

describe('file de travaux', () => {
  async function makeJob(runAt = new Date()): Promise<string> {
    await prisma.$transaction((tx) =>
      enqueue(tx, {
        type: 'order.confirmation',
        payload: { test: PREFIX, orderId: 'inexistante' },
        runAt,
      }),
    )
    const job = await prisma.job.findFirstOrThrow({
      where: { payload: { path: ['test'], equals: PREFIX } },
      select: { id: true },
    })
    return job.id
  }

  it('ne prend pas un travail programmé plus tard', async () => {
    const id = await makeJob(new Date(Date.now() + 3_600_000))

    const claimed = await claimJobs('essai', 10)
    expect(claimed.some((job) => job.id === id)).toBe(false)
  })

  it('deux exécutions concurrentes ne prennent pas le même travail', async () => {
    // Vercel ne garantit pas l'exclusion entre deux passages du cron. Sans
    // verrou, chaque e-mail partirait deux fois.
    const id = await makeJob()

    const [a, b] = await Promise.all([
      claimJobs('worker-a', 10),
      claimJobs('worker-b', 10),
    ])

    // On compte les prises de CE travail, pas la taille des lots : la question
    // est « ce travail a-t-il été pris deux fois ? », et elle se pose de la
    // même façon que la file contienne un travail ou mille.
    const taken = [...a, ...b].filter((job) => job.id === id)
    expect(taken).toHaveLength(1)
  })

  it('un travail terminé n’est plus repris', async () => {
    const id = await makeJob()
    await claimJobs('essai', 10)
    await completeJob(id)

    const again = await claimJobs('essai', 10)
    expect(again.some((job) => job.id === id)).toBe(false)
  })

  it('un travail en échec redevient prenable, et compte ses tentatives', async () => {
    const id = await makeJob()

    const first = await claimJobs('essai', 10)
    expect(first[0]?.attempts).toBe(1)
    await failJob(id, 'prestataire indisponible')

    const second = await claimJobs('essai', 10)
    expect(second[0]?.id).toBe(id)
    expect(second[0]?.attempts).toBe(2)
  })

  it('cesse de réessayer au-delà du plafond', async () => {
    const id = await makeJob()
    await prisma.job.update({ where: { id }, data: { attempts: 5 } })

    const claimed = await claimJobs('essai', 10)
    expect(claimed.some((job) => job.id === id)).toBe(false)
  })

  it('une commande disparue est classée, pas réessayée cinq fois', async () => {
    // Réessayer d'envoyer la confirmation d'une commande effacée ne la fera
    // pas réapparaître.
    await makeJob()

    const report = await runJobs()
    expect(report.done).toBeGreaterThanOrEqual(1)
    expect(report.failed).toBe(0)
  })
})

describe('facture et e-mails à la vente', () => {
  async function makePaidOrder(suffix: string) {
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
    const article = await prisma.article.create({
      data: {
        sku: `${PREFIX}${suffix}`,
        slug: `invjob-${suffix}`,
        condition: 'GOOD',
        sizeLabel: 'M',
        sizeNormalized: 'M',
        priceCents: 2500,
        costCents: 800,
        floorPriceCents: 1500,
        weightGrams: 400,
        status: 'RESERVED',
        reservedById: 'proprio',
        reservedUntil: new Date(Date.now() + 1_800_000),
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        categoryId: category.id,
      },
      select: { id: true },
    })

    const order = await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}${suffix}`,
        lockOwnerId: 'proprio',
        email: 'acheteuse@exemple.fr',
        locale: 'fr',
        status: 'PENDING_PAYMENT',
        subtotalCents: 2500,
        shippingCents: 490,
        totalCents: 2990,
        shippingAddress: { firstName: 'Nina', city: 'Lille', postalCode: '59000' },
        billingAddress: { city: 'Lille' },
        shippingCarrierCode: 'mock',
        shippingServiceCode: 'standard',
        items: {
          create: [
            {
              articleId: article.id,
              titleSnapshot: 'Veste',
              imageSnapshot: '',
              unitPriceCents: 2500,
              costCentsSnapshot: 800,
            },
          ],
        },
      },
      select: { id: true },
    })

    return order.id
  }

  it('inscrit les deux e-mails dans la transaction de la vente', async () => {
    const orderId = await makePaidOrder('m1')

    await markOrderPaid({
      orderId,
      paymentIntentId: 'pi_x',
      paidAt: new Date('2026-08-22T09:00:00Z'),
    })

    const jobs = await prisma.job.findMany({
      where: { payload: { path: ['orderId'], equals: orderId } },
      select: { type: true, completedAt: true },
    })

    expect(jobs.map((job) => job.type).sort()).toEqual([
      'order.confirmation',
      'order.notify-shop',
    ])
    // Inscrits, pas envoyés : c'est le cron qui les exécutera.
    expect(jobs.every((job) => job.completedAt === null)).toBe(true)
  })

  it('n’émet pas de facture tant que l’identité légale manque', async () => {
    // Consommer un numéro pour un document sans dénomination ni SIRET ferait
    // un trou dans la suite le jour où on le corrigerait.
    const before = await currentCounter()
    const orderId = await makePaidOrder('m2')

    await markOrderPaid({
      orderId,
      paymentIntentId: 'pi_y',
      paidAt: new Date('2026-08-22T09:00:00Z'),
    })

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { invoiceNumber: true },
    })

    // L'identité légale n'est pas renseignée dans l'environnement de test.
    expect(order.invoiceNumber).toBeNull()
    expect(await currentCounter()).toBe(before)
  })

  it('rejouée, n’inscrit pas les e-mails une seconde fois', async () => {
    const orderId = await makePaidOrder('m3')
    const paidAt = new Date('2026-08-22T09:00:00Z')

    await markOrderPaid({ orderId, paymentIntentId: 'pi_z', paidAt })
    await markOrderPaid({ orderId, paymentIntentId: 'pi_z', paidAt })

    const count = await prisma.job.count({
      where: { payload: { path: ['orderId'], equals: orderId } },
    })
    expect(count).toBe(2)
  })
})

describe('envoi effectif', () => {
  async function makeOrderAndJob(suffix: string): Promise<string> {
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
    const article = await prisma.article.create({
      data: {
        sku: `${PREFIX}${suffix}`,
        slug: `invjob-${suffix}`,
        condition: 'GOOD',
        sizeLabel: 'M',
        sizeNormalized: 'M',
        priceCents: 2000,
        costCents: 600,
        floorPriceCents: 1200,
        weightGrams: 300,
        status: 'AVAILABLE',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        categoryId: category.id,
      },
      select: { id: true },
    })

    const order = await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}${suffix}`,
        email: 'acheteuse@exemple.fr',
        locale: 'fr',
        status: 'PAID',
        subtotalCents: 2000,
        shippingCents: 0,
        totalCents: 2000,
        shippingAddress: { firstName: 'Nina', city: 'Lille', postalCode: '59000' },
        billingAddress: {},
        shippingCarrierCode: 'mock',
        shippingServiceCode: 'standard',
        items: {
          create: [
            {
              articleId: article.id,
              titleSnapshot: 'Chemise',
              imageSnapshot: '',
              unitPriceCents: 2000,
              costCentsSnapshot: 600,
            },
          ],
        },
      },
      select: { id: true },
    })

    await prisma.$transaction((tx) =>
      enqueue(tx, {
        type: 'order.confirmation',
        payload: { test: PREFIX, orderId: order.id },
      }),
    )

    return order.id
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('compose la confirmation et classe le travail', async () => {
    // Sans clé d'envoi, et en développement uniquement, le message est résumé
    // dans la console : le gabarit, les traductions et la relecture de la
    // commande sont bien exercés de bout en bout.
    vi.stubEnv('NODE_ENV', 'development')
    // Le corps est masqué par défaut — il porte le nom et l'adresse postale.
    // Ce test-ci veut justement l'inspecter, et le demande donc explicitement :
    // c'est exactement l'usage pour lequel ce drapeau existe.
    vi.stubEnv('EMAIL_DEV_SHOW_BODY', '1')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const orderId = await makeOrderAndJob('s1')
    const report = await runJobs()

    expect(report.done).toBeGreaterThanOrEqual(1)

    const job = await prisma.job.findFirstOrThrow({
      where: { payload: { path: ['orderId'], equals: orderId } },
      select: { completedAt: true, lastError: true },
    })
    expect(job.completedAt).not.toBeNull()
    expect(job.lastError).toBeNull()

    // Le contenu réel : numéro de commande, montant, et l'adresse masquée.
    const printed = info.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain(`${PREFIX}s1`)
    expect(printed).toContain('20,00')
    expect(printed).not.toContain('acheteuse@exemple.fr')
  })

  it('masque le corps du message quand on ne l’a pas demandé', async () => {
    // Le défaut d'origine : la console masquait soigneusement l'adresse du
    // destinataire, puis imprimait le message ENTIER juste en dessous — nom,
    // rue, code postal, ville. Le masque ne protégeait rien.
    vi.stubEnv('NODE_ENV', 'development')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    await makeOrderAndJob('s2')
    await runJobs()

    const printed = info.mock.calls.map((call) => String(call[0])).join('\n')

    // L'objet reste lisible : on sait quel message est parti.
    expect(printed).toContain(`${PREFIX}s2`)
    // Le contenu, non.
    expect(printed).not.toContain('20,00')
    expect(printed).toContain('EMAIL_DEV_SHOW_BODY')
  })

  it('un envoi impossible laisse le travail reprenable, jamais perdu', async () => {
    // Hors développement, l'absence de clé est une erreur franche : un e-mail
    // qu'on croit parti et qui n'est jamais parti est pire qu'une erreur.
    const orderId = await makeOrderAndJob('s2')

    const report = await runJobs()
    expect(report.failed).toBeGreaterThanOrEqual(1)

    const job = await prisma.job.findFirstOrThrow({
      where: { payload: { path: ['orderId'], equals: orderId } },
      select: { completedAt: true, lastError: true, attempts: true, lockedAt: true },
    })

    expect(job.completedAt).toBeNull()
    expect(job.lastError).toContain('RESEND_API_KEY')
    expect(job.attempts).toBe(1)
    // Verrou relâché : le prochain passage du cron le reprendra.
    expect(job.lockedAt).toBeNull()
  })
})
