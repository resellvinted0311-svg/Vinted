import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import { listPendingOffers, countPendingOffers } from '@/lib/db/queries/admin-offers'
import { respondToOffer } from '@/lib/shop/offers'

/**
 * Répondre à une offre, contre une vraie base.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces tests protègent
 * ---------------------------------------------------------------------------
 * Deux choses, et la seconde est celle qui manquait :
 *
 *  - la file du vendeur montre ce qu'il doit trancher, dans l'ordre où cela
 *    expire, avec les chiffres sans lesquels la décision se prend au jugé ;
 *  - répondre PRÉVIENT la personne. `respondToOffer` acceptait une offre,
 *    posait une échéance de validité du prix, et n'inscrivait aucun e-mail.
 *    L'acheteuse avait vingt-quatre heures pour payer un prix dont elle
 *    n'apprenait jamais qu'il lui était accordé.
 */

const PREFIX = 'ADMOFF-'
const HOUR = 60 * 60 * 1000

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { type: { startsWith: 'offer.' } } })
  await prisma.offer.deleteMany({
    where: { article: { sku: { startsWith: PREFIX } } },
  })
  await prisma.article.deleteMany({ where: { sku: { startsWith: PREFIX } } })
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

async function makeArticle(
  suffix: string,
  { priceCents = 4000, floorPriceCents = 2500 } = {},
): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } })
  const article = await prisma.article.create({
    data: {
      sku: `${PREFIX}${suffix}`,
      slug: `admoff-${suffix}`,
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents,
      costCents: 1200,
      floorPriceCents,
      weightGrams: 400,
      status: 'AVAILABLE',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      categoryId: category.id,
      translations: {
        create: [{ locale: 'fr', title: 'Manteau', description: 'Description.' }],
      },
    },
    select: { id: true },
  })
  return article.id
}

async function makeOffer(
  articleId: string,
  {
    amountCents = 3000,
    expiresInHours = 24,
    parentOfferId = null as string | null,
    status = 'PENDING' as 'PENDING' | 'ACCEPTED',
  } = {},
): Promise<string> {
  const offer = await prisma.offer.create({
    data: {
      articleId,
      guestEmail: `${PREFIX}acheteuse@exemple.fr`,
      guestSessionToken: `${PREFIX}jeton`,
      amountCents,
      status,
      parentOfferId,
      expiresAt: new Date(Date.now() + expiresInHours * HOUR),
    },
    select: { id: true },
  })
  return offer.id
}

/**
 * La file, bornée aux pièces de CE fichier.
 *
 * `listPendingOffers` lit toute la file du vendeur — c'est son travail. Mais la
 * base de développement porte les offres laissées par les autres suites, et une
 * assertion sur la longueur totale mesurerait leur nombre plutôt que le
 * comportement testé.
 */
async function mine(now?: Date) {
  const all = await listPendingOffers('fr', now ? { now } : {})
  return all.filter((row) => row.article.sku.startsWith(PREFIX))
}

function offerJobs(type: string) {
  return prisma.job.findMany({ where: { type }, select: { payload: true } })
}

// ---------------------------------------------------------------------------
// Ce que la file du vendeur montre
// ---------------------------------------------------------------------------

describe('file des offres à trancher', () => {
  it('remonte ce qui expire en premier, pas ce qui vient d’arriver', async () => {
    // Le réflexe serait de trier par date de dépôt décroissante. Il mettrait en
    // tête celles qui ont le plus de temps devant elles, et laisserait mourir
    // les autres en bas de page.
    const articleId = await makeArticle('ordre')
    await makeOffer(articleId, { amountCents: 3000, expiresInHours: 40 })
    await makeOffer(articleId, { amountCents: 3100, expiresInHours: 2 })
    await makeOffer(articleId, { amountCents: 3200, expiresInHours: 20 })

    const file = await mine()
    expect(file.map((row) => row.amountCents)).toEqual([3100, 3200, 3000])
  })

  it('donne les trois chiffres de la décision', async () => {
    const articleId = await makeArticle('chiffres', {
      priceCents: 4000,
      floorPriceCents: 2500,
    })
    await makeOffer(articleId, { amountCents: 3000 })

    const [row] = await mine()
    expect(row?.article).toMatchObject({
      priceCents: 4000,
      floorPriceCents: 2500,
      costCents: 1200,
    })
    // L'écart au plancher est calculé serveur : le faire de tête sur une file
    // de vingt offres est le meilleur moyen de se tromper une fois.
    expect(row?.marginToFloorCents).toBe(500)
    expect(row?.belowFloor).toBe(false)
  })

  it('signale une offre qui passe sous le plancher', async () => {
    const articleId = await makeArticle('sous', { floorPriceCents: 2500 })
    await makeOffer(articleId, { amountCents: 2200 })

    const [row] = await mine()
    expect(row?.belowFloor).toBe(true)
    expect(row?.marginToFloorCents).toBe(-300)
  })

  it('écarte les contre-propositions déjà émises', async () => {
    // Elles portent le même statut PENDING, mais c'est l'ACHETEUSE qui doit y
    // répondre. Les laisser ferait croire au vendeur qu'il a quelque chose à
    // faire de sa propre proposition.
    const articleId = await makeArticle('contre')
    const parentId = await makeOffer(articleId, { amountCents: 3000 })
    await makeOffer(articleId, { amountCents: 3400, parentOfferId: parentId })

    const file = await mine()
    expect(file).toHaveLength(1)
    expect(file[0]?.amountCents).toBe(3000)

    // Le compteur du tableau de bord applique le même filtre : il ne doit pas
    // annoncer une décision à prendre là où le vendeur a déjà répondu.
    const before = await countPendingOffers()
    await prisma.offer.update({
      where: { id: parentId },
      data: { status: 'REJECTED', respondedAt: new Date() },
    })
    expect(await countPendingOffers()).toBe(before - 1)
  })

  it('marque une offre échue plutôt que de la faire disparaître', async () => {
    // Le balayage ne passe que par intermittence : une offre expirée il y
    // a trois minutes doit être visible telle qu'elle est.
    const articleId = await makeArticle('echue')
    await makeOffer(articleId, { expiresInHours: -1 })

    const [row] = await mine()
    expect(row?.lapsed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ce que répondre déclenche
// ---------------------------------------------------------------------------

describe('réponse du vendeur', () => {
  it('accepter PRÉVIENT la personne, et rend le prix payable', async () => {
    // LE défaut que ce lot corrige : la réponse était muette.
    const articleId = await makeArticle('accepte')
    const offerId = await makeOffer(articleId, { amountCents: 3000 })

    const result = await respondToOffer({
      offerId,
      response: { action: 'accept' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.status).toBe('ACCEPTED')
    expect(result.priceValidUntil).toBeInstanceOf(Date)

    const jobs = await offerJobs('offer.respond')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toMatchObject({ offerId })
  })

  it('refuser prévient AUSSI', async () => {
    // Un refus silencieux est presque pire qu'une acceptation silencieuse : la
    // personne attend une réponse déjà donnée, et ne peut pas reproposer
    // puisque son offre n'est plus en attente.
    const articleId = await makeArticle('refuse')
    const offerId = await makeOffer(articleId, { amountCents: 3000 })

    await respondToOffer({ offerId, response: { action: 'reject' } })

    const jobs = await offerJobs('offer.respond')
    expect(jobs).toHaveLength(1)
  })

  it('n’inscrit RIEN quand la réponse n’a pas porté', async () => {
    // Deuxième onglet, double clic, balayage concurrent : la transition est
    // conditionnelle en base. Un e-mail inscrit sur une réponse qui n'a pas eu
    // lieu annoncerait une décision qui n'a pas été prise.
    const articleId = await makeArticle('course')
    const offerId = await makeOffer(articleId, { amountCents: 3000 })

    await respondToOffer({ offerId, response: { action: 'accept' } })
    await prisma.job.deleteMany({ where: { type: 'offer.respond' } })

    const second = await respondToOffer({ offerId, response: { action: 'reject' } })
    expect(second.ok).toBe(false)
    expect(await offerJobs('offer.respond')).toHaveLength(0)
  })

  it('trace le franchissement du plancher, sans l’interdire', async () => {
    // Vendre à perte est une décision commerciale, elle appartient au vendeur.
    // Mais elle doit rester explicable six mois plus tard.
    const articleId = await makeArticle('plancher', { floorPriceCents: 2500 })
    const offerId = await makeOffer(articleId, { amountCents: 2200 })

    const result = await respondToOffer({ offerId, response: { action: 'accept' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.belowFloor).toBe(true)

    const stored = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { acceptedBelowFloor: true },
    })
    expect(stored.acceptedBelowFloor).toBe(true)
  })

  it('ne réserve RIEN en acceptant', async () => {
    // Le brief l'interdit : une offre acceptée est une promesse de prix bornée
    // dans le temps, pas une mise de côté. La pièce reste en vente.
    const articleId = await makeArticle('sansverrou')
    const offerId = await makeOffer(articleId, { amountCents: 3000 })

    await respondToOffer({ offerId, response: { action: 'accept' } })

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true, reservedById: true, reservedUntil: true },
    })
    expect(article).toEqual({
      status: 'AVAILABLE',
      reservedById: null,
      reservedUntil: null,
    })
  })
})
