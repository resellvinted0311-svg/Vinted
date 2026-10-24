import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

/**
 * La rétractation en ligne — « Renoncer au contrat ici ».
 *
 * ---------------------------------------------------------------------------
 * Ce que ces cas tiennent fermé
 * ---------------------------------------------------------------------------
 * Obligatoire depuis le 19 juin 2026 (directive 2023/2673) : une fonction en
 * ligne, un accusé de réception reprenant le contenu, la date et l'heure. Trois
 * défauts seraient silencieux :
 *
 *  - un ORACLE : la page dirait si un couple numéro + adresse existe, et
 *    deviendrait la machine à essayer des couples que le registre des
 *    commandes refuse délibérément d'offrir ;
 *  - une DEUXIÈME déclaration qui réécrirait la date de la première — c'est
 *    elle qui fait courir le délai de remboursement ;
 *  - des données personnelles dans la FILE : `Job.payload` ne porte que des
 *    identifiants internes.
 */

const envoyes: { to: string; subject: string; text: string; html: string }[] =
  []

vi.mock('@/lib/providers/email/send', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/providers/email/send')>()
  return {
    ...actual,
    sendEmail: async (message: {
      to: string
      subject: string
      text: string
      html: string
    }) => {
      envoyes.push(message)
    },
  }
})

vi.mock('@/lib/config/site', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/site')>()
  return {
    ...actual,
    LEGAL: {
      ...actual.LEGAL,
      companyName: 'Nina & Diego',
      address: '12 rue du Registre, 59000 Lille',
      email: 'boutique@nina-diego.test',
    },
  }
})

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '198.51.100.9', 'user-agent': 'vitest' }),
}))

const { prisma } = await import('@/lib/db/client')
const { __resetRateLimitForTests } = await import('@/lib/security/rate-limit')
const { recordWithdrawal, WITHDRAWAL_REASON } =
  await import('@/lib/shop/withdrawal')
const { submitWithdrawalAction } = await import('@/lib/shop/withdrawal-actions')
const { runJobNow } = await import('@/lib/jobs/worker')

/** Une plage de numéros qu'aucune vraie commande n'atteindra avant 2099. */
const PREFIXE = 'CMD-2099-99'
const EMAIL = 'retractation@nina-diego.test'

async function nettoyer(): Promise<void> {
  const commandes = await prisma.order.findMany({
    where: { orderNumber: { startsWith: PREFIXE } },
    select: { id: true },
  })
  const ids = commandes.map((c) => c.id)
  await prisma.job.deleteMany({
    where: {
      type: { in: ['withdrawal.acknowledge', 'withdrawal.notify-shop'] },
    },
  })
  await prisma.returnRequest.deleteMany({ where: { orderId: { in: ids } } })
  await prisma.order.deleteMany({ where: { id: { in: ids } } })
}

let numero = 0

async function commande(
  statut: 'PAID' | 'SHIPPED' | 'PENDING_PAYMENT' = 'PAID',
): Promise<{ id: string; orderNumber: string }> {
  numero += 1
  const piece = await prisma.article.findFirstOrThrow({ select: { id: true } })
  const adresse = {
    firstName: 'Camille',
    lastName: 'Exemple',
    line1: '1 rue',
    postalCode: '59000',
    city: 'Lille',
    country: 'FR',
  }
  return prisma.order.create({
    data: {
      orderNumber: `${PREFIXE}${String(numero).padStart(4, '0')}`,
      status: statut,
      locale: 'fr',
      email: EMAIL,
      subtotalCents: 4500,
      shippingCents: 415,
      totalCents: 4915,
      shippingCarrierCode: 'mondial_relay',
      shippingServiceCode: 'MR_RELAY',
      shippingAddress: adresse,
      billingAddress: adresse,
      paidAt: statut === 'PENDING_PAYMENT' ? null : new Date(),
      items: {
        create: {
          articleId: piece.id,
          titleSnapshot: 'Veste <en> laine',
          imageSnapshot: '',
          unitPriceCents: 4500,
          costCentsSnapshot: 1500,
        },
      },
    },
    select: { id: true, orderNumber: true },
  })
}

function declaration(
  orderNumber: string,
  overrides: Record<string, string> = {},
) {
  return {
    name: 'Camille Exemple',
    orderNumber,
    email: EMAIL,
    locale: 'fr' as const,
    ...overrides,
  }
}

function formulaire(valeurs: Record<string, string>): FormData {
  const form = new FormData()
  for (const [cle, valeur] of Object.entries(valeurs)) form.set(cle, valeur)
  return form
}

beforeEach(async () => {
  envoyes.length = 0
  __resetRateLimitForTests()
  await nettoyer()
})

afterAll(async () => {
  await nettoyer()
  await prisma.$disconnect()
})

describe('l’enregistrement', () => {
  it('enregistre la déclaration et inscrit l’accusé ET l’avis à la boutique', async () => {
    const { id, orderNumber } = await commande('PAID')

    const { jobIds } = await recordWithdrawal(declaration(orderNumber))

    const demandes = await prisma.returnRequest.findMany({
      where: { orderId: id },
      select: { reason: true, declaredName: true, orderItemIds: true },
    })
    expect(demandes).toHaveLength(1)
    expect(demandes[0]?.reason).toBe(WITHDRAWAL_REASON)
    expect(demandes[0]?.declaredName).toBe('Camille Exemple')
    expect(demandes[0]?.orderItemIds).toHaveLength(1)

    const travaux = await prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: { type: true, payload: true },
      orderBy: { type: 'asc' },
    })
    expect(travaux.map((t) => t.type)).toEqual([
      'withdrawal.acknowledge',
      'withdrawal.notify-shop',
    ])
    // Ni nom, ni adresse dans la file : un identifiant, et rien d'autre.
    for (const travail of travaux) {
      expect(Object.keys(travail.payload as object)).toEqual([
        'returnRequestId',
      ])
      expect(JSON.stringify(travail.payload)).not.toContain(EMAIL)
      expect(JSON.stringify(travail.payload)).not.toContain('Camille')
    }
  })

  it('ne réécrit pas une déclaration existante, et ne renvoie que l’accusé', async () => {
    // La date de la PREMIÈRE déclaration fait courir le remboursement : une
    // seconde qui l'écraserait le repousserait d'autant.
    const { id, orderNumber } = await commande('SHIPPED')
    await recordWithdrawal(declaration(orderNumber))
    const premiere = await prisma.returnRequest.findFirstOrThrow({
      where: { orderId: id },
      select: { id: true, requestedAt: true },
    })

    const { jobIds } = await recordWithdrawal(
      declaration(orderNumber, { name: 'Autre Nom' }),
    )

    const demandes = await prisma.returnRequest.findMany({
      where: { orderId: id },
      select: { id: true, requestedAt: true, declaredName: true },
    })
    expect(demandes).toEqual([{ ...premiere, declaredName: 'Camille Exemple' }])
    const travaux = await prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: { type: true },
    })
    // La boutique n'est pas prévenue deux fois.
    expect(travaux.map((t) => t.type)).toEqual(['withdrawal.acknowledge'])
  })

  it('n’écrit RIEN quand l’adresse ne correspond pas', async () => {
    const { id, orderNumber } = await commande('PAID')

    const { jobIds } = await recordWithdrawal(
      declaration(orderNumber, { email: 'quelquun@ailleurs.test' }),
    )

    expect(jobIds).toEqual([])
    expect(await prisma.returnRequest.count({ where: { orderId: id } })).toBe(0)
  })

  it('n’écrit rien pour une commande jamais payée : il n’y a pas de contrat', async () => {
    const { id, orderNumber } = await commande('PENDING_PAYMENT')

    const { jobIds } = await recordWithdrawal(declaration(orderNumber))

    expect(jobIds).toEqual([])
    expect(await prisma.returnRequest.count({ where: { orderId: id } })).toBe(0)
  })
})

describe('les messages', () => {
  it('l’accusé reprend le contenu, la date et l’heure — et échappe le HTML', async () => {
    const { orderNumber } = await commande('PAID')
    const { jobIds } = await recordWithdrawal(declaration(orderNumber))

    for (const id of jobIds) await runJobNow(id)

    const accuse = envoyes.find((m) => m.to === EMAIL)
    expect(accuse, 'accusé de réception non envoyé').toBeDefined()
    expect(accuse!.subject).toContain(orderNumber)
    expect(accuse!.text).toContain('Camille Exemple')
    expect(accuse!.text).toContain(EMAIL)
    expect(accuse!.text).toContain(orderNumber)
    // L'heure, et pas seulement le jour : « 24 octobre 2026 à 10:32 ».
    expect(accuse!.text).toMatch(/\d{1,2}:\d{2}/)
    expect(accuse!.text).toContain('12 rue du Registre')
    // Un titre venu de la base ne casse pas le message.
    expect(accuse!.html).toContain('Veste &lt;en&gt; laine')
    expect(accuse!.html).not.toContain('<en>')

    const avis = envoyes.find((m) => m.to === 'boutique@nina-diego.test')
    expect(avis, 'avis à la boutique non envoyé').toBeDefined()
    // Payée mais pas encore partie : la consigne qui compte.
    expect(avis!.text).toContain('ne l’expédiez pas')
    expect(avis!.text).toContain('Remboursement dû au plus tard le')
  })
})

describe('l’action publique', () => {
  it('répond la MÊME chose que la commande existe ou non', async () => {
    const { orderNumber } = await commande('PAID')

    const existe = await submitWithdrawalAction(
      { status: 'idle' },
      formulaire({ ...declaration(orderNumber) }),
    )
    const inconnue = await submitWithdrawalAction(
      { status: 'idle' },
      formulaire({ ...declaration(`${PREFIXE}9999`) }),
    )

    expect(existe.status).toBe('sent')
    expect(inconnue.status).toBe('sent')
    // Mêmes clés, même forme : rien ne distingue les deux réponses, hormis
    // l'instant, qui est celui du serveur.
    expect(Object.keys(existe).sort()).toEqual(Object.keys(inconnue).sort())
  })

  it('accepte un numéro recopié en minuscules et entouré d’espaces', async () => {
    const { id, orderNumber } = await commande('PAID')

    const etat = await submitWithdrawalAction(
      { status: 'idle' },
      formulaire({
        ...declaration(`  ${orderNumber.toLowerCase()} `),
        email: `  ${EMAIL.toUpperCase()} `,
      }),
    )

    expect(etat.status).toBe('sent')
    expect(await prisma.returnRequest.count({ where: { orderId: id } })).toBe(1)
  })

  it('refuse une saisie illisible, sans rien écrire', async () => {
    const etat = await submitWithdrawalAction(
      { status: 'idle' },
      formulaire({ ...declaration('pas-un-numero'), name: 'X' }),
    )

    expect(etat).toEqual({ status: 'error', messageKey: 'invalid' })
  })
})
