import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import {
  submitOffer,
  respondToOffer,
  answerCounterOffer,
  readOfferEmailData,
} from '@/lib/shop/offers'
import { listOffers } from '@/lib/db/queries/offers'

/**
 * La contre-proposition, des deux côtés, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce lot n'a pas été livré à moitié
 * ---------------------------------------------------------------------------
 * `respondToOffer` savait émettre une contre-proposition depuis le premier
 * jour, et rien ne permettait d'y répondre. Le bouton du vendeur, livré seul,
 * aurait ENFERMÉ l'acheteuse : une contre-proposition est une offre en attente
 * à son nom, et `already-pending` lui interdit d'en déposer une autre tant
 * qu'elle attend.
 *
 * Les tests ci-dessous exercent la boucle entière, et surtout les trois défauts
 * qui n'étaient visibles qu'une fois le geste possible : l'e-mail qui annonçait
 * un refus, le plancher jamais comparé, et la carence qui punissait un refus
 * qu'elle n'avait pas prononcé.
 */

const PREFIX = 'CONTRE-'
const EMAIL = 'contre@nina-diego.test'

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'contre' } },
    select: { id: true },
  })
  const ids = users.map((u) => u.id)

  await prisma.offer.deleteMany({ where: { article: { sku: { startsWith: PREFIX } } } })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
  if (ids.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(
  suffix: string,
  { priceCents = 10_000, floorPriceCents = 6_000 } = {},
) {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })

  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `contre-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents,
      costCents: 3_000,
      floorPriceCents,
      weightGrams: 400,
      status: 'AVAILABLE',
      allowOffers: true,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
      translations: {
        create: { locale: 'fr', title: `Pull ${suffix}`, description: 'x' },
      },
    },
    select: { id: true },
  })

  return article
}

async function makeUser(suffix: string) {
  return prisma.user.create({
    data: { email: `contre-${suffix}@nina-diego.test`, locale: 'fr' },
    select: { id: true, email: true },
  })
}

/** Dépose une offre au nom d'un compte, et renvoie son identifiant. */
async function offerFrom(
  userId: string,
  articleId: string,
  amountCents: number,
): Promise<string> {
  const result = await submitOffer({
    articleId,
    amountCents,
    owner: { userId, sessionToken: 'jeton-test', email: EMAIL },
  })
  if (!result.ok) throw new Error(`dépôt refusé : ${result.rejection}`)
  return result.offerId
}

describe('émettre une contre-proposition', () => {
  it('chaîne une nouvelle offre en attente au nom de l’acheteuse', async () => {
    const user = await makeUser('a')
    const article = await makeArticle('a')
    const offerId = await offerFrom(user.id, article.id, 7_000)

    const result = await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('COUNTERED')
    expect(result.counterOfferId).toBeDefined()

    const counter = await prisma.offer.findUniqueOrThrow({
      where: { id: result.counterOfferId! },
      select: { amountCents: true, status: true, parentOfferId: true, userId: true },
    })
    expect(counter.amountCents).toBe(8_500)
    expect(counter.status).toBe('PENDING')
    expect(counter.parentOfferId).toBe(offerId)
    // Elle porte l'identité de l'acheteuse : c'est ce qui lui permet de la voir
    // dans son registre et d'y répondre.
    expect(counter.userId).toBe(user.id)
  })

  it('REFUSE sur une offre déposée sans compte', async () => {
    // C'est ce refus qui ferme le piège. Le registre des offres vit sous
    // `/compte` : une invitée n'aurait aucun écran où accepter ou décliner, et
    // `already-pending` la bloquerait sur cette pièce jusqu'à l'échéance.
    const article = await makeArticle('b')
    const guest = await submitOffer({
      articleId: article.id,
      amountCents: 7_000,
      owner: { userId: null, sessionToken: 'jeton-invitee', email: EMAIL },
    })
    if (!guest.ok) throw new Error('dépôt invité refusé')

    const result = await respondToOffer({
      offerId: guest.offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })

    expect(result).toEqual({ ok: false, reason: 'counter-needs-account' })

    // Et rien n'a bougé : l'offre reste en attente, donc répondable autrement.
    const after = await prisma.offer.findUniqueOrThrow({
      where: { id: guest.offerId },
      select: { status: true },
    })
    expect(after.status).toBe('PENDING')
  })

  it('refuse un montant qui n’est pas une contre-proposition', async () => {
    const user = await makeUser('c')
    const article = await makeArticle('c')
    const offerId = await offerFrom(user.id, article.id, 7_000)

    // Au-dessus du prix affiché : ce n'est plus une négociation.
    expect(
      await respondToOffer({
        offerId,
        response: { action: 'counter', counterAmountCents: 12_000 },
      }),
    ).toEqual({ ok: false, reason: 'invalid-counter' })

    // Sous l'offre reçue : ce serait négocier contre soi-même.
    expect(
      await respondToOffer({
        offerId,
        response: { action: 'counter', counterAmountCents: 6_500 },
      }),
    ).toEqual({ ok: false, reason: 'invalid-counter' })
  })

  it('exige une déclaration sous le prix plancher', async () => {
    // Le défaut réparé : `respondToOffer` ne comparait la contre-offre à AUCUN
    // plancher. Le vendeur pouvait proposer lui-même un prix déficitaire, et
    // rien ne le signalait ni ne le consignait.
    const user = await makeUser('d')
    const article = await makeArticle('d', { priceCents: 10_000, floorPriceCents: 8_000 })
    const offerId = await offerFrom(user.id, article.id, 6_000)

    expect(
      await respondToOffer({
        offerId,
        response: { action: 'counter', counterAmountCents: 7_000 },
      }),
    ).toEqual({ ok: false, reason: 'counter-below-floor' })

    // Déclarée, elle passe : vendre à perte est une décision commerciale, elle
    // appartient au vendeur — elle doit seulement être prise sciemment.
    const assumed = await respondToOffer({
      offerId,
      response: {
        action: 'counter',
        counterAmountCents: 7_000,
        confirmBelowFloor: true,
      },
    })
    expect(assumed.ok).toBe(true)
  })
})

describe('l’e-mail de contre-proposition', () => {
  it('n’annonce PAS un refus', async () => {
    // Le mensonge réparé : `readOfferEmailData` rabattait tout statut autre
    // qu'ACCEPTED ou PENDING sur « refusée ». L'acheteuse aurait lu « votre
    // proposition n'a pas été retenue » au moment précis où on lui en fait une.
    const user = await makeUser('e')
    const article = await makeArticle('e')
    const offerId = await offerFrom(user.id, article.id, 7_000)

    await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })

    const data = await readOfferEmailData(offerId)

    expect(data?.outcome).toBe('countered')
    expect(data?.counterAmountCents).toBe(8_500)
  })

  it('porte l’échéance de la CONTRE-proposition, pas celle de l’offre', async () => {
    // Celle de l'offre d'origine est le délai de réponse du VENDEUR, qu'il
    // vient de consommer. L'annoncer donnerait à l'acheteuse un délai déjà
    // expiré pour répondre.
    const user = await makeUser('f')
    const article = await makeArticle('f')
    const offerId = await offerFrom(user.id, article.id, 7_000)

    const original = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { expiresAt: true },
    })

    const result = await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })
    if (!result.ok) throw new Error('contre-proposition refusée')

    const counter = await prisma.offer.findUniqueOrThrow({
      where: { id: result.counterOfferId! },
      select: { expiresAt: true },
    })

    const data = await readOfferEmailData(offerId)
    expect(data?.expiresAt).toEqual(counter.expiresAt)
    expect(data?.expiresAt).not.toEqual(original.expiresAt)
  })

  it('est réellement inscrit dans la file', async () => {
    const user = await makeUser('g')
    const article = await makeArticle('g')
    const offerId = await offerFrom(user.id, article.id, 7_000)

    await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })

    // Il était volontairement écarté tant que son gabarit disait « refusée ».
    const jobs = await prisma.job.count({
      where: {
        type: 'offer.respond',
        payload: { path: ['offerId'], equals: offerId },
      },
    })
    expect(jobs).toBe(1)
  })
})

describe('répondre à une contre-proposition', () => {
  async function counteredSetup(suffix: string) {
    const user = await makeUser(suffix)
    const article = await makeArticle(suffix)
    const offerId = await offerFrom(user.id, article.id, 7_000)
    const result = await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })
    if (!result.ok || !result.counterOfferId) throw new Error('contre-offre absente')
    return { user, article, offerId, counterOfferId: result.counterOfferId }
  }

  it('acceptée, le prix devient payable', async () => {
    const { user, counterOfferId } = await counteredSetup('h')

    const answer = await answerCounterOffer({
      counterOfferId,
      userId: user.id,
      answer: 'accept',
    })

    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.accepted).toBe(true)
    expect(answer.priceValidUntil).not.toBeNull()

    const row = await prisma.offer.findUniqueOrThrow({
      where: { id: counterOfferId },
      select: { status: true, priceValidUntil: true, respondedAt: true },
    })
    expect(row.status).toBe('ACCEPTED')
    expect(row.priceValidUntil).not.toBeNull()
    expect(row.respondedAt).not.toBeNull()
  })

  it('déclinée, elle LIBÈRE la personne au lieu de la punir', async () => {
    // Le troisième défaut réparé. La carence se déclenchait sur la dernière
    // offre REJECTED sans écarter les contre-propositions : décliner une
    // proposition DU VENDEUR aurait interdit à l'acheteuse de proposer quoi
    // que ce soit pendant des heures. Elle n'a rien demandé.
    const { user, article, counterOfferId } = await counteredSetup('i')

    const answer = await answerCounterOffer({
      counterOfferId,
      userId: user.id,
      answer: 'decline',
    })
    expect(answer.ok).toBe(true)

    const again = await submitOffer({
      articleId: article.id,
      amountCents: 7_500,
      owner: { userId: user.id, sessionToken: 'jeton-test', email: EMAIL },
    })

    expect(again.ok, 'décliner ne doit pas déclencher la carence').toBe(true)
  })

  it('refuse la ligne de quelqu’un d’autre', async () => {
    // Un identifiant d'offre suffirait sinon à rendre payable — donc à
    // s'accorder — le prix négocié par une autre personne.
    const { counterOfferId } = await counteredSetup('j')
    const intrus = await makeUser('intrus')

    expect(
      await answerCounterOffer({
        counterOfferId,
        userId: intrus.id,
        answer: 'accept',
      }),
    ).toEqual({ ok: false, reason: 'not-found' })

    const row = await prisma.offer.findUniqueOrThrow({
      where: { id: counterOfferId },
      select: { status: true },
    })
    expect(row.status).toBe('PENDING')
  })

  it('refuse d’accepter sa PROPRE offre déguisée en contre-proposition', async () => {
    // Sans le contrôle de `parentOfferId`, l'identifiant de sa propre offre en
    // attente suffirait à s'accorder son propre prix.
    const user = await makeUser('k')
    const article = await makeArticle('k')
    const offerId = await offerFrom(user.id, article.id, 7_000)

    expect(
      await answerCounterOffer({ counterOfferId: offerId, userId: user.id, answer: 'accept' }),
    ).toEqual({ ok: false, reason: 'not-a-counter' })
  })

  it('ne répond qu’une fois', async () => {
    const { user, counterOfferId } = await counteredSetup('l')

    expect(
      (await answerCounterOffer({ counterOfferId, userId: user.id, answer: 'accept' })).ok,
    ).toBe(true)
    expect(
      await answerCounterOffer({ counterOfferId, userId: user.id, answer: 'decline' }),
    ).toEqual({ ok: false, reason: 'not-pending' })
  })

  it('refuse une contre-proposition échue', async () => {
    const { user, counterOfferId } = await counteredSetup('m')

    // Le balayage ne passe que par intermittence : c'est l'échéance qui
    // fait foi, pas le statut.
    const far = new Date(Date.now() + 365 * 24 * 3_600_000)
    expect(
      await answerCounterOffer({
        counterOfferId,
        userId: user.id,
        answer: 'accept',
        now: far,
      }),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuse quand la pièce est partie entre-temps', async () => {
    const { user, article, counterOfferId } = await counteredSetup('n')
    await prisma.article.update({
      where: { id: article.id },
      data: { status: 'SOLD', soldAt: new Date() },
    })

    expect(
      await answerCounterOffer({ counterOfferId, userId: user.id, answer: 'accept' }),
    ).toEqual({ ok: false, reason: 'article-unavailable' })
  })

  it('consigne la vente à perte à l’acceptation', async () => {
    // C'est l'instant où le prix devient réellement dû : sans cette écriture,
    // `acceptedBelowFloor` resterait faux sur la ligne qui porte le prix payé.
    const user = await makeUser('o')
    const article = await makeArticle('o', { priceCents: 10_000, floorPriceCents: 9_000 })
    const offerId = await offerFrom(user.id, article.id, 6_000)

    const result = await respondToOffer({
      offerId,
      response: {
        action: 'counter',
        counterAmountCents: 8_000,
        confirmBelowFloor: true,
      },
    })
    if (!result.ok || !result.counterOfferId) throw new Error('contre-offre absente')

    await answerCounterOffer({
      counterOfferId: result.counterOfferId,
      userId: user.id,
      answer: 'accept',
    })

    const row = await prisma.offer.findUniqueOrThrow({
      where: { id: result.counterOfferId },
      select: { acceptedBelowFloor: true },
    })
    expect(row.acceptedBelowFloor).toBe(true)
  })
})

describe('le registre de l’acheteuse', () => {
  it('propose le geste sur la contre-proposition, pas sur l’offre d’origine', async () => {
    // Les deux lignes coexistent. La première porte « countered » et raconte ce
    // qui s'est passé ; c'est la seconde qui attend une réponse. Poser les
    // boutons sur la première — le réflexe — les mettrait sur une ligne close.
    const user = await makeUser('p')
    const article = await makeArticle('p')
    const offerId = await offerFrom(user.id, article.id, 7_000)
    const result = await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })
    if (!result.ok) throw new Error('contre-offre absente')

    const rows = await listOffers(user.id, 'fr')
    const original = rows.find((row) => row.id === offerId)
    const counter = rows.find((row) => row.id === result.counterOfferId)

    expect(original?.standing).toBe('countered')
    expect(original?.canAnswer).toBe(false)

    expect(counter?.fromShop).toBe(true)
    expect(counter?.canAnswer).toBe(true)
    expect(counter?.amountCents).toBe(8_500)
  })

  it('retire le geste une fois la réponse donnée', async () => {
    const user = await makeUser('q')
    const article = await makeArticle('q')
    const offerId = await offerFrom(user.id, article.id, 7_000)
    const result = await respondToOffer({
      offerId,
      response: { action: 'counter', counterAmountCents: 8_500 },
    })
    if (!result.ok || !result.counterOfferId) throw new Error('contre-offre absente')

    await answerCounterOffer({
      counterOfferId: result.counterOfferId,
      userId: user.id,
      answer: 'accept',
    })

    const rows = await listOffers(user.id, 'fr')
    const counter = rows.find((row) => row.id === result.counterOfferId)
    expect(counter?.canAnswer).toBe(false)
    expect(counter?.standing).toBe('payable')
  })
})
