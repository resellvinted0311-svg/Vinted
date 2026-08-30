import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import {
  createShopArticle,
  updateShopArticle,
  applyListing,
  loadArticleWriteContext,
  type ArticleWriteInput,
} from '@/lib/articles/persistence'
import { routing } from '@/lib/i18n/routing'

/**
 * Écrire une pièce depuis la régie, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces tests protègent
 * ---------------------------------------------------------------------------
 * Chaque refus vérifié ici correspond à une façon concrète de perdre de
 * l'argent : vendre sous le prix de revient, écraser une baisse automatique,
 * retirer une pièce que quelqu'un est en train de payer, ou publier une fiche
 * que le catalogue n'affichera pas.
 *
 * Les cas passants, eux, ne prouvent qu'une chose — que le formulaire écrit
 * quelque chose. C'est le moins intéressant.
 */

const PREFIX = 'ADM-'

async function cleanup(): Promise<void> {
  const articles = await prisma.article.findMany({
    where: { slug: { startsWith: 'adm-' } },
    select: { id: true },
  })
  const ids = articles.map((a) => a.id)
  if (ids.length > 0) {
    await prisma.offer.deleteMany({ where: { articleId: { in: ids } } })
    await prisma.orderItem.deleteMany({ where: { articleId: { in: ids } } })
    await prisma.articleImage.deleteMany({ where: { articleId: { in: ids } } })
  }
  await prisma.article.deleteMany({ where: { slug: { startsWith: 'adm-' } } })
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

/** Une catégorie FEUILLE du jeu de données. */
async function leafCategory(): Promise<string> {
  const rows = await prisma.category.findMany({
    select: { id: true, _count: { select: { children: true } } },
  })
  const leaf = rows.find((row) => row._count.children === 0)
  if (!leaf) throw new Error('le jeu de données ne porte aucune catégorie feuille')
  return leaf.id
}

async function baseInput(over: Partial<ArticleWriteInput> = {}): Promise<ArticleWriteInput> {
  return {
    categoryId: await leafCategory(),
    brandName: 'Maison Test',
    condition: 'GOOD',
    sizeLabel: 'M',
    title: 'Chemise de régie',
    priceCents: 9_900,
    costCents: 1_000,
    weightGrams: 400,
    allowOffers: true,
    autoDropEnabled: false,
    ...over,
  }
}

/** Force le slug dans l'espace de nommage des tests, pour le nettoyage. */
async function markForCleanup(articleId: string): Promise<string> {
  const article = await prisma.article.update({
    where: { id: articleId },
    data: { slug: `adm-${articleId}` },
    select: { slug: true, updatedAt: true },
  })
  return article.slug
}

async function createTestArticle(
  over: Partial<ArticleWriteInput> = {},
): Promise<{ id: string; updatedAt: Date }> {
  const result = await createShopArticle(await baseInput(over))
  if (!result.ok) throw new Error(`création refusée : ${result.reason}`)
  await markForCleanup(result.articleId)

  const row = await prisma.article.findUniqueOrThrow({
    where: { id: result.articleId },
    select: { id: true, updatedAt: true },
  })
  return row
}

async function addImage(articleId: string): Promise<string> {
  const image = await prisma.articleImage.create({
    data: {
      articleId,
      url: 'https://exemple.test/photo.webp',
      width: 1000,
      height: 1000,
      position: 0,
    },
    select: { id: true },
  })
  return image.id
}

describe('créer une pièce', () => {
  it('la crée en BROUILLON, sans identifiant externe, avec ses huit traductions', async () => {
    const { id } = await createTestArticle()

    const article = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        externalId: true,
        publishedAt: true,
        floorPriceCents: true,
        translations: { select: { locale: true } },
      },
    })

    // Brouillon TOUJOURS. Non parce que la publication sans photo serait
    // interdite — elle ne l'est plus — mais parce que la CRÉATION ne publie
    // jamais : on décrit une pièce, on la met en vente ensuite, et ce sont deux
    // gestes. Créer et publier d'un coup ferait apparaître au catalogue une
    // fiche à demi remplie, au premier enregistrement.
    expect(article.status).toBe('DRAFT')
    expect(article.publishedAt).toBeNull()

    // La frontière avec le monde du partenaire : une pièce née ici n'entre pas
    // dans le flux de synchronisation, où un import écraserait le travail.
    expect(article.externalId).toBeNull()

    // HUIT lignes, pas une. Le catalogue joint les traductions en INNER JOIN :
    // une pièce qui n'aurait qu'une ligne `fr` serait ABSENTE des sept autres
    // catalogues, pas mal traduite.
    expect(article.translations).toHaveLength(routing.locales.length)

    expect(article.floorPriceCents).toBeGreaterThan(0)
  })

  it('REFUSE un prix de vente sous le plancher', async () => {
    // Le plancher couvre le coût d'achat, le port estimé, les cotisations, la
    // commission et la marge minimale. En dessous, la vente est à perte.
    const result = await createShopArticle(
      await baseInput({ priceCents: 1, costCents: 5_000 }),
    )
    expect(result).toEqual({ ok: false, reason: 'price-below-floor' })
  })

  it('REFUSE un poids qu’aucun tarif transporteur ne couvre', async () => {
    // Inventer un tarif au-delà du dernier palier, c'est facturer un port que
    // personne n'a négocié — et le payer soi-même.
    const result = await createShopArticle(
      await baseInput({ weightGrams: 49_000, priceCents: 500_00 }),
    )
    expect(result).toEqual({ ok: false, reason: 'weight-not-covered' })
  })

  it('REFUSE une catégorie qui n’est pas une feuille', async () => {
    const parent = await prisma.category.findFirst({
      where: { children: { some: {} } },
      select: { id: true },
    })
    if (!parent) return

    // Rangée dans un rayon intermédiaire, la pièce n'apparaîtrait dans aucune
    // de ses sous-catégories : invisible là où on la cherche.
    const result = await createShopArticle(await baseInput({ categoryId: parent.id }))
    expect(result).toEqual({ ok: false, reason: 'category-not-leaf' })
  })

  it('recalcule le plancher côté serveur, quoi qu’on lui passe', async () => {
    const context = await loadArticleWriteContext(await leafCategory())
    expect(context.ok).toBe(true)

    const cheap = await createTestArticle({ costCents: 500, priceCents: 9_900 })
    const dear = await createTestArticle({ costCents: 4_000, priceCents: 9_900 })

    const [a, b] = await Promise.all([
      prisma.article.findUniqueOrThrow({
        where: { id: cheap.id },
        select: { floorPriceCents: true },
      }),
      prisma.article.findUniqueOrThrow({
        where: { id: dear.id },
        select: { floorPriceCents: true },
      }),
    ])

    // Un coût d'achat plus élevé remonte le plancher : c'est la propriété qui
    // fait que le plancher protège vraiment.
    expect(b.floorPriceCents).toBeGreaterThan(a.floorPriceCents)
  })
})

describe('modifier une pièce', () => {
  it('REFUSE si la pièce a bougé depuis le rendu du formulaire', async () => {
    const { id, updatedAt } = await createTestArticle()

    // Quelqu'un — ou le balayage de baisse — touche la pièce entre le rendu du
    // formulaire et son envoi.
    await prisma.article.update({
      where: { id },
      data: { priceCents: 8_800 },
    })

    const result = await updateShopArticle(
      id,
      await baseInput({ priceCents: 12_000 }),
      updatedAt,
    )

    expect(result).toEqual({ ok: false, reason: 'modified-meanwhile' })

    // Et RIEN n'a été écrit : c'est le point. Sans la comparaison, le prix
    // corrigé entre-temps aurait été écrasé sans laisser de trace.
    const after = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { priceCents: true },
    })
    expect(after.priceCents).toBe(8_800)
  })

  it('n’efface PAS le prix barré posé par la baisse automatique', async () => {
    const { id } = await createTestArticle({ priceCents: 9_900 })

    // Le balayage a baissé le prix et inscrit le prix d'ORIGINE en barré.
    const dropped = await prisma.article.update({
      where: { id },
      data: { priceCents: 8_900, comparePriceCents: 9_900 },
      select: { updatedAt: true },
    })

    // La boutiquière corrige simplement le titre.
    const result = await updateShopArticle(
      id,
      await baseInput({ title: 'Titre corrigé', priceCents: 8_900 }),
      dropped.updatedAt,
    )
    expect(result.ok).toBe(true)

    const after = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { comparePriceCents: true },
    })

    // Sans cette garantie, la base du palier suivant retomberait sur le prix
    // DÉJÀ baissé : les remises se composeraient et la pièce descendrait
    // palier après palier jusqu'au plancher.
    expect(after.comparePriceCents).toBe(9_900)
  })

  it('efface le prix barré quand le nouveau prix le rattrape', async () => {
    const { id } = await createTestArticle({ priceCents: 9_900 })
    const dropped = await prisma.article.update({
      where: { id },
      data: { priceCents: 8_900, comparePriceCents: 9_900 },
      select: { updatedAt: true },
    })

    const result = await updateShopArticle(
      id,
      await baseInput({ priceCents: 10_500 }),
      dropped.updatedAt,
    )
    expect(result.ok).toBe(true)

    const after = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { comparePriceCents: true },
    })

    // Le laisser afficherait une réduction qui n'en est plus une.
    expect(after.comparePriceCents).toBeNull()
  })

  it('REFUSE de modifier une pièce vendue', async () => {
    const { id, updatedAt } = await createTestArticle()
    await prisma.article.update({
      where: { id },
      data: { status: 'SOLD', soldAt: new Date() },
    })

    // Son prix figure sur une facture qui a valeur comptable pendant dix ans.
    const result = await updateShopArticle(id, await baseInput(), updatedAt)
    expect(result).toEqual({ ok: false, reason: 'not-editable' })
  })
})

describe('mettre en vente', () => {
  it('publie sans photo, et pose quand même la date de mise en ligne', async () => {
    // La régie refusait autrefois de publier une pièce sans visuel. La règle est
    // tombée avec le contrat de synchronisation : l'inventaire n'a pas de photos
    // à envoyer, et interdire à la main ce que l'import fait par centaines
    // n'avait plus de sens.
    //
    // Ce qui compte ici est la conséquence FONCTIONNELLE, pas le booléen : sans
    // `publishedAt`, une pièce AVAILABLE est introuvable au catalogue, en 404
    // sur sa fiche et impossible à mettre au panier. Le premier écrit de cette
    // levée serait donc un stock « en vente » que personne ne peut voir.
    const { id } = await createTestArticle()

    expect(await applyListing(id, 'publish')).toEqual({
      ok: true,
      status: 'AVAILABLE',
      voidedOffers: 0,
    })

    const published = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { status: true, publishedAt: true, images: { select: { id: true } } },
    })
    expect(published.status).toBe('AVAILABLE')
    expect(published.publishedAt).not.toBeNull()
    expect(published.images).toHaveLength(0)
  })

  it('publie, pose la date de mise en ligne et efface le réservataire', async () => {
    const { id } = await createTestArticle()
    await addImage(id)

    // Un verrou ÉCHU : le balayage qui les libère passe toutes les cinq
    // minutes, donc l'état peut traîner.
    await prisma.article.update({
      where: { id },
      data: {
        status: 'RESERVED',
        reservedById: 'jeton-mort',
        reservedUntil: new Date(Date.now() - 60_000),
      },
    })

    const result = await applyListing(id, 'publish')
    expect(result).toMatchObject({ ok: true, status: 'AVAILABLE' })

    const after = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { status: true, publishedAt: true, reservedById: true },
    })

    expect(after.status).toBe('AVAILABLE')
    // Sans date de mise en ligne, la pièce est exclue de la visibilité
    // publique : introuvable au catalogue, 404 sur sa fiche, refusée par le
    // verrou de stock. « En vente » et inachetable.
    expect(after.publishedAt).not.toBeNull()
    // Sans cet effacement, la pièce traînerait l'identité de qui l'avait au
    // panier — colonne classée privée.
    expect(after.reservedById).toBeNull()
  })

  it('ne repositionne PAS la date de mise en ligne d’une pièce republiée', async () => {
    const { id } = await createTestArticle()
    await addImage(id)

    const firstPublish = new Date('2020-01-01T00:00:00.000Z')
    await prisma.article.update({
      where: { id },
      data: { status: 'ARCHIVED', publishedAt: firstPublish },
    })

    await applyListing(id, 'publish')

    const after = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { publishedAt: true },
    })

    // La repositionner ferait remonter en tête des nouveautés une pièce qui
    // traîne depuis six mois, et remettrait à zéro le compte à rebours des
    // offres.
    expect(after.publishedAt?.toISOString()).toBe(firstPublish.toISOString())
  })
})

describe('retirer de la vente', () => {
  it('REFUSE quand une commande attend son paiement', async () => {
    const { id } = await createTestArticle()
    await addImage(id)
    await applyListing(id, 'publish')

    const order = await prisma.order.create({
      data: {
        orderNumber: `${PREFIX}0001`,
        status: 'PENDING_PAYMENT',
        email: 'acheteuse@nina-diego.test',
        locale: 'fr',
        subtotalCents: 9_900,
        discountCents: 0,
        shippingCents: 0,
        totalCents: 9_900,
        shippingAddress: {},
        billingAddress: {},
        shippingCarrierCode: 'mondial_relay',
        shippingServiceCode: 'MR_RELAY',
      },
      select: { id: true },
    })
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        articleId: id,
        titleSnapshot: 'Chemise de régie',
        imageSnapshot: 'https://exemple.test/photo.webp',
        unitPriceCents: 9_900,
        costCentsSnapshot: 1_000,
      },
    })

    // Le cas le plus coûteux : Stripe ne garantit ni l'ordre ni le délai de ses
    // webhooks et ROUVRE une commande annulée. Une pièce retirée entre-temps
    // sort de la clause qu'exige l'encaissement — argent pris, commande payée,
    // facture numérotée, pièce jamais marquée vendue.
    expect(await applyListing(id, 'withdraw')).toEqual({
      ok: false,
      reason: 'awaiting-payment',
    })

    const after = await prisma.article.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    })
    expect(after.status).toBe('AVAILABLE')
  })

  it('éteint les offres en cours, avec le bon motif', async () => {
    const { id } = await createTestArticle()
    await addImage(id)
    await applyListing(id, 'publish')

    await prisma.offer.create({
      data: {
        articleId: id,
        guestEmail: 'negociatrice@nina-diego.test',
        amountCents: 8_000,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const result = await applyListing(id, 'withdraw')
    expect(result).toMatchObject({ ok: true, status: 'ARCHIVED', voidedOffers: 1 })

    const offer = await prisma.offer.findFirstOrThrow({
      where: { articleId: id },
      select: { status: true, rejectionReason: true },
    })

    expect(offer.status).toBe('VOIDED')
    // Le motif dit la vérité : la pièce n'a pas été vendue, elle a été retirée.
    // `ARTICLE_SOLD` aurait été un mensonge dans une trace qu'on relit.
    expect(offer.rejectionReason).toBe('ARTICLE_WITHDRAWN')
  })

  it('REFUSE de retirer une pièce qu’un panier tient', async () => {
    const { id } = await createTestArticle()
    await addImage(id)
    await applyListing(id, 'publish')

    await prisma.article.update({
      where: { id },
      data: {
        status: 'RESERVED',
        reservedById: 'jeton-vivant',
        reservedUntil: new Date(Date.now() + 600_000),
      },
    })

    expect(await applyListing(id, 'withdraw')).toEqual({
      ok: false,
      reason: 'reserved',
    })
  })
})
