import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  listOrders,
  getOrder,
  getOrderByCheckoutSession,
  checkoutSessionExists,
} from '@/lib/db/queries/orders'
import type { CartOwner } from '@/lib/shop/cart'

/**
 * Lecture des commandes : à qui appartient quoi.
 *
 * Le paiement sans compte est autorisé, donc une commande peut appartenir à un
 * COMPTE ou à un JETON de session. Ce test existe pour une seule raison : une
 * erreur de portée ici ne casse rien, n'échoue nulle part, et affiche l'adresse
 * postale de quelqu'un d'autre.
 *
 * On vérifie contre une vraie base, parce que la propriété testée est la clause
 * `where` réellement envoyée à PostgreSQL — pas ce qu'on croit avoir écrit.
 */

const PREFIX = 'HIST-'
const TOKEN_A = 'jeton-acheteuse-a'
const TOKEN_B = 'jeton-acheteuse-b'

function owner(overrides: Partial<CartOwner>): CartOwner {
  return {
    userId: null,
    sessionToken: '',
    lockOwnerId: '',
    ...overrides,
  }
}

async function cleanup(): Promise<void> {
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: PREFIX } } },
  })
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@histoire.test' } } })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(suffix: string): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `histoire-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 2400,
      costCents: 700,
      floorPriceCents: 1400,
      weightGrams: 400,
      status: 'SOLD',
      soldAt: new Date(),
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
    },
    select: { id: true },
  })
  return article.id
}

interface OrderOptions {
  userId?: string | null
  lockOwnerId?: string | null
  status?: 'PENDING_PAYMENT' | 'PAID' | 'SHIPPED' | 'CANCELLED'
  stripeSessionId?: string
  createdAt?: Date
}

async function makeOrder(suffix: string, options: OrderOptions = {}) {
  const articleId = await makeArticle(suffix)

  return prisma.order.create({
    data: {
      orderNumber: `${PREFIX}${suffix}`,
      userId: options.userId ?? null,
      lockOwnerId: options.lockOwnerId ?? null,
      email: 'acheteuse@histoire.test',
      locale: 'fr',
      status: options.status ?? 'PAID',
      subtotalCents: 2400,
      shippingCents: 490,
      totalCents: 2890,
      shippingCostCents: 372,
      shippingAddress: { city: 'Lille', line1: '12 rue du Registre' },
      billingAddress: { city: 'Lille', line1: '12 rue du Registre' },
      shippingCarrierCode: 'MONDIAL_RELAY',
      shippingServiceCode: 'POINT_RELAIS',
      ...(options.stripeSessionId ? { stripeSessionId: options.stripeSessionId } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.status === 'PAID' || options.status === 'SHIPPED'
        ? { paidAt: new Date(), invoiceNumber: `${PREFIX}FA-${suffix}` }
        : {}),
      items: {
        create: {
          articleId,
          titleSnapshot: `Pièce ${suffix}`,
          imageSnapshot: 'https://exemple.test/photo.jpg',
          unitPriceCents: 2400,
          costCentsSnapshot: 700,
        },
      },
    },
    select: { id: true, orderNumber: true },
  })
}

describe('portée des commandes', () => {
  it('ne montre pas la commande d’une autre personne', async () => {
    await makeOrder('a1', { lockOwnerId: TOKEN_A })
    await makeOrder('b1', { lockOwnerId: TOKEN_B })

    const forA = await listOrders(owner({ lockOwnerId: TOKEN_A }))

    expect(forA).toHaveLength(1)
    expect(forA[0]?.orderNumber).toBe(`${PREFIX}a1`)
  })

  it('refuse une commande dont on connaît le numéro sans en être propriétaire', async () => {
    // Un numéro de commande est court et lisible. S'il suffisait à ouvrir la
    // commande, il suffirait à lire l'adresse postale de quelqu'un d'autre.
    const other = await makeOrder('b2', { lockOwnerId: TOKEN_B })

    const stolen = await getOrder(owner({ lockOwnerId: TOKEN_A }), other.orderNumber)

    expect(stolen).toBeNull()
  })

  it('ne renvoie RIEN quand personne n’est identifié', async () => {
    // Le piège : une clause `where` construite à partir d'un propriétaire vide
    // devient une clause vide, et une clause vide renvoie toute la boutique.
    await makeOrder('a3', { lockOwnerId: TOKEN_A })
    await makeOrder('b3', { lockOwnerId: TOKEN_B })

    const anonymous = owner({})

    expect(await listOrders(anonymous)).toHaveLength(0)
    expect(await getOrder(anonymous, `${PREFIX}a3`)).toBeNull()
    expect(
      await getOrderByCheckoutSession(anonymous, 'cs_test_peu_importe'),
    ).toBeNull()
  })

  it('ne confond pas la chaîne vide avec un propriétaire', async () => {
    // Une commande sans propriétaire de verrou existe : commande ancienne,
    // reprise manuelle. Elle ne doit appartenir à personne, surtout pas au
    // premier compte venu sans cookie boutique.
    await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}orpheline`,
        lockOwnerId: '',
        email: 'inconnue@histoire.test',
        locale: 'fr',
        status: 'PAID',
        paidAt: new Date(),
        subtotalCents: 1000,
        shippingCents: 0,
        totalCents: 1000,
        shippingAddress: { city: 'Lille' },
        billingAddress: { city: 'Lille' },
        shippingCarrierCode: 'COLISSIMO',
        shippingServiceCode: 'DOMICILE',
      },
    })

    const user = await prisma.user.create({
      data: { email: 'connectee@histoire.test', role: 'CUSTOMER' },
      select: { id: true },
    })

    const found = await listOrders(
      owner({ userId: user.id, lockOwnerId: '', sessionToken: '' }),
    )

    expect(found).toHaveLength(0)
  })

  it('retrouve ses commandes par le compte comme par le jeton', async () => {
    const user = await prisma.user.create({
      data: { email: 'fidele@histoire.test', role: 'CUSTOMER' },
      select: { id: true },
    })

    // Achetée en visiteuse, avant l'inscription.
    await makeOrder('avant', { lockOwnerId: TOKEN_A })
    // Achetée une fois connectée.
    await makeOrder('apres', { userId: user.id, lockOwnerId: user.id })

    const both = await listOrders(
      owner({ userId: user.id, lockOwnerId: TOKEN_A, sessionToken: TOKEN_A }),
    )

    expect(both.map((order) => order.orderNumber).sort()).toEqual([
      `${PREFIX}apres`,
      `${PREFIX}avant`,
    ])
  })
})

describe('contenu de l’historique', () => {
  it('cache une tentative de paiement jamais aboutie', async () => {
    // Une tentative abandonnée n'est pas un achat. L'afficher ferait croire à
    // une commande en cours, et à un débit à venir.
    await makeOrder('abandon', {
      lockOwnerId: TOKEN_A,
      status: 'PENDING_PAYMENT',
    })
    await makeOrder('payee', { lockOwnerId: TOKEN_A })

    const visible = await listOrders(owner({ lockOwnerId: TOKEN_A }))

    expect(visible).toHaveLength(1)
    expect(visible[0]?.orderNumber).toBe(`${PREFIX}payee`)
  })

  it('montre une commande annulée', async () => {
    // Annulée ≠ inexistante : la personne doit pouvoir constater l'annulation,
    // c'est souvent la trace qu'elle cherche.
    await makeOrder('annulee', { lockOwnerId: TOKEN_A, status: 'CANCELLED' })

    const visible = await listOrders(owner({ lockOwnerId: TOKEN_A }))
    expect(visible).toHaveLength(1)
    expect(visible[0]?.status).toBe('CANCELLED')
  })

  it('range la plus récente en premier', async () => {
    await makeOrder('vieille', {
      lockOwnerId: TOKEN_A,
      createdAt: new Date('2026-01-05T10:00:00Z'),
    })
    await makeOrder('recente', {
      lockOwnerId: TOKEN_A,
      createdAt: new Date('2026-06-05T10:00:00Z'),
    })

    const visible = await listOrders(owner({ lockOwnerId: TOKEN_A }))
    expect(visible[0]?.orderNumber).toBe(`${PREFIX}recente`)
  })
})

describe('ce qui ne sort jamais', () => {
  it('ne renvoie ni le coût d’achat ni le coût transporteur réel', async () => {
    await makeOrder('marge', { lockOwnerId: TOKEN_A })

    const detail = await getOrder(owner({ lockOwnerId: TOKEN_A }), `${PREFIX}marge`)
    expect(detail).not.toBeNull()

    // On sérialise et on cherche la valeur, pas seulement la clé : un objet
    // imbriqué oublié ne se voit pas en inspectant les clés du premier niveau.
    const serialized = JSON.stringify(detail)

    expect(serialized).not.toContain('costCentsSnapshot')
    expect(serialized).not.toContain('shippingCostCents')
    expect(serialized).not.toContain('stripeSessionId')
    expect(serialized).not.toContain('lockOwnerId')
    // 372 centimes = coût transporteur réel, 700 = coût d'achat de la pièce.
    expect(serialized).not.toContain('372')
    expect(serialized).not.toContain('700')
    // Ce qui doit y être, en revanche : le port facturé.
    expect(detail?.shippingCents).toBe(490)
  })
})

describe('page de retour de paiement', () => {
  it('retrouve la commande par sa session, pour son propriétaire', async () => {
    await makeOrder('retour', {
      lockOwnerId: TOKEN_A,
      stripeSessionId: 'cs_test_retour_proprietaire',
    })

    const found = await getOrderByCheckoutSession(
      owner({ lockOwnerId: TOKEN_A }),
      'cs_test_retour_proprietaire',
    )

    expect(found?.orderNumber).toBe(`${PREFIX}retour`)
  })

  it('ne l’ouvre pas à quelqu’un qui a seulement l’URL', async () => {
    // L'identifiant de session est imprévisible, mais il circule : historique
    // du navigateur, capture d'écran, lien recollé. Ce n'est pas un secret.
    await makeOrder('urlvolee', {
      lockOwnerId: TOKEN_B,
      stripeSessionId: 'cs_test_url_partagee',
    })

    const found = await getOrderByCheckoutSession(
      owner({ lockOwnerId: TOKEN_A }),
      'cs_test_url_partagee',
    )

    expect(found).toBeNull()
    // Mais on sait qu'elle existe : c'est ce qui permet de dire « cette
    // commande n'est pas la vôtre » plutôt que « cette commande n'existe pas ».
    expect(await checkoutSessionExists('cs_test_url_partagee')).toBe(true)
    expect(await checkoutSessionExists('cs_test_inventee')).toBe(false)
  })

  it('trouve une commande encore en attente du webhook', async () => {
    // Le cas le plus fréquent à cet instant : la redirection du navigateur a
    // gagné la course contre l'appel de Stripe. La commande doit être lisible,
    // sinon la page annonce un échec sur un paiement réussi.
    await makeOrder('enattente', {
      lockOwnerId: TOKEN_A,
      status: 'PENDING_PAYMENT',
      stripeSessionId: 'cs_test_webhook_en_retard',
    })

    const found = await getOrderByCheckoutSession(
      owner({ lockOwnerId: TOKEN_A }),
      'cs_test_webhook_en_retard',
    )

    expect(found?.status).toBe('PENDING_PAYMENT')
  })
})
