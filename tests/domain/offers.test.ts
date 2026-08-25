import { describe, it, expect } from 'vitest'
import {
  evaluateOffer,
  isAcceptedPriceUsable,
  isBelowFloor,
  offerNeedsAttention,
  offerStanding,
  payablePriceCents,
  shouldAutoAccept,
  type OfferArticleFacts,
  type OfferHistoryFacts,
  type OfferPolicy,
  buyerMayAnswer,
} from '@/lib/domain/offers'

/**
 * Ce que ces tests protègent : le prix affiché, et la marge.
 *
 * Une négociation mal bornée coûte des deux côtés — un prix demandé que plus
 * personne ne paie parce qu'il suffit d'attendre, et des ventes déficitaires
 * qu'aucune alerte ne signale. Les deux se jouent ici, dans des fonctions
 * pures, avant toute base de données.
 */

const NOW = new Date('2026-08-20T12:00:00.000Z')

const POLICY: OfferPolicy = {
  minOfferAmountCents: 800,
  maxOffersPerArticlePerUser: 3,
  offerCooldownAfterRejectionHours: 48,
  offerResponseHours: 48,
  acceptedOfferValidityHours: 24,
  autoAcceptOffersEnabled: false,
  autoAcceptThresholdPercent: null,
}

const ARTICLE: OfferArticleFacts = {
  status: 'AVAILABLE',
  publishedAt: new Date('2026-08-01T00:00:00.000Z'),
  allowOffers: true,
  offersOpenAt: new Date('2026-08-08T00:00:00.000Z'),
  priceCents: 3800,
  minOfferCents: 2100,
  floorPriceCents: 2340,
}

const HISTORY: OfferHistoryFacts = {
  attempts: 0,
  hasPending: false,
  lastRejectedAt: null,
}

function evaluate(
  amountCents: number,
  patch: {
    article?: Partial<OfferArticleFacts>
    history?: Partial<OfferHistoryFacts>
    policy?: Partial<OfferPolicy>
    now?: Date
  } = {},
) {
  return evaluateOffer({
    amountCents,
    article: { ...ARTICLE, ...patch.article },
    history: { ...HISTORY, ...patch.history },
    policy: { ...POLICY, ...patch.policy },
    now: patch.now ?? NOW,
  })
}

// ---------------------------------------------------------------------------
// L'état de la pièce
// ---------------------------------------------------------------------------

describe('ce qui n’est même pas déposé', () => {
  it('refuse quand la pièce n’accepte pas les offres', () => {
    const verdict = evaluate(3000, { article: { allowOffers: false } })
    expect(verdict).toEqual({ ok: false, rejection: 'offers-disabled' })
  })

  it('refuse sur une pièce vendue, archivée ou en brouillon', () => {
    for (const status of ['SOLD', 'ARCHIVED', 'DRAFT'] as const) {
      const verdict = evaluate(3000, { article: { status } })
      expect(verdict, status).toMatchObject({
        ok: false,
        rejection: 'article-unavailable',
      })
    }
  })

  it('refuse sur une pièce en cours de paiement', () => {
    // RESERVED reste LISTÉE — la réservation dure quinze minutes et expire le
    // plus souvent, la masquer ferait clignoter le catalogue. Mais négocier
    // par-dessus quelqu'un qui a sa carte en main n'a aucun sens.
    const verdict = evaluate(3000, { article: { status: 'RESERVED' } })
    expect(verdict).toMatchObject({ rejection: 'article-unavailable' })
  })

  it('refuse sur une pièce jamais mise en ligne', () => {
    const verdict = evaluate(3000, { article: { publishedAt: null } })
    expect(verdict).toMatchObject({ rejection: 'article-unavailable' })
  })

  it('refuse avant l’ouverture des offres, et dit quand', () => {
    // Une pièce négociable dès la première heure ne se vend jamais au prix
    // affiché : il suffit d'attendre.
    const openAt = new Date('2026-08-25T00:00:00.000Z')
    const verdict = evaluate(3000, { article: { offersOpenAt: openAt } })

    expect(verdict).toEqual({
      ok: false,
      rejection: 'offers-not-open-yet',
      retryAt: openAt,
    })
  })

  it('accepte une pièce sans date d’ouverture', () => {
    expect(evaluate(3000, { article: { offersOpenAt: null } }).ok).toBe(true)
  })
})

describe('ce que l’historique interdit', () => {
  it('refuse une seconde offre tant que la première attend', () => {
    // Empiler les offres permettrait de faire monter les enchères contre
    // soi-même et de noyer le vendeur sous des propositions contradictoires.
    expect(evaluate(3000, { history: { hasPending: true } })).toEqual({
      ok: false,
      rejection: 'already-pending',
    })
  })

  it('refuse au-delà du plafond de tentatives', () => {
    expect(evaluate(3000, { history: { attempts: 3 } })).toEqual({
      ok: false,
      rejection: 'too-many-attempts',
    })
    expect(evaluate(3000, { history: { attempts: 2 } }).ok).toBe(true)
  })

  it('impose un délai de carence après un refus, et dit sa fin', () => {
    // Sans carence, un refus se contourne en renvoyant la même offre à un
    // centime près, indéfiniment.
    const rejectedAt = new Date('2026-08-20T00:00:00.000Z')
    const verdict = evaluate(3000, { history: { lastRejectedAt: rejectedAt } })

    expect(verdict).toEqual({
      ok: false,
      rejection: 'cooldown',
      retryAt: new Date('2026-08-22T00:00:00.000Z'),
    })
  })

  it('rouvre une fois la carence passée', () => {
    const rejectedAt = new Date('2026-08-18T00:00:00.000Z')
    expect(evaluate(3000, { history: { lastRejectedAt: rejectedAt } }).ok).toBe(
      true,
    )
  })
})

// ---------------------------------------------------------------------------
// Le montant
// ---------------------------------------------------------------------------

describe('le montant proposé', () => {
  it('refuse sous le plancher absolu', () => {
    expect(evaluate(500)).toEqual({
      ok: false,
      rejection: 'below-absolute-minimum',
    })
  })

  it('refuse une offre au prix affiché ou au-dessus', () => {
    // Ce n'est pas une offre, c'est un achat. L'enregistrer ferait attendre
    // quarante-huit heures une réponse à une question qui n'en est pas une —
    // et la pièce peut partir pendant ce temps.
    expect(evaluate(3800)).toMatchObject({
      rejection: 'not-below-asking-price',
    })
    expect(evaluate(4200)).toMatchObject({
      rejection: 'not-below-asking-price',
    })
    expect(evaluate(3799).ok).toBe(true)
  })

  it('ENREGISTRE et refuse sous le minimum de la pièce', () => {
    // La distinction compte : l'offre est déposée, elle porte une trace, elle
    // compte dans les tentatives et elle ouvre une carence. La faire
    // disparaître laisserait la personne sans réponse ni explication.
    const verdict = evaluate(2000)

    expect(verdict).toEqual({
      ok: true,
      outcome: 'auto-rejected',
      expiresAt: new Date('2026-08-22T12:00:00.000Z'),
    })
  })

  it('laisse passer une offre au-dessus du minimum de la pièce', () => {
    expect(evaluate(2100)).toEqual({
      ok: true,
      outcome: 'pending',
      expiresAt: new Date('2026-08-22T12:00:00.000Z'),
    })
  })

  it('accepte n’importe quel montant admissible sans minimum de pièce', () => {
    const verdict = evaluate(900, { article: { minOfferCents: null } })
    expect(verdict).toMatchObject({ ok: true, outcome: 'pending' })
  })

  it('répond l’état de la pièce avant de juger le montant', () => {
    // Dire « votre offre est trop basse » sur une pièce déjà vendue ferait
    // proposer plus cher pour rien.
    const verdict = evaluate(100, { article: { status: 'SOLD' } })
    expect(verdict).toMatchObject({ rejection: 'article-unavailable' })
  })
})

// ---------------------------------------------------------------------------
// Acceptation automatique
// ---------------------------------------------------------------------------

describe('acceptation automatique', () => {
  it('n’a lieu de rien par défaut', () => {
    // Si les acheteurs découvrent qu'une offre basse passe toute seule, le
    // prix affiché devient décoratif. Le brief l'interdit par défaut.
    expect(evaluate(3600)).toMatchObject({ outcome: 'pending' })
    expect(shouldAutoAccept(3600, ARTICLE, POLICY)).toBe(false)
  })

  it('reste inerte si le seuil n’est pas réglé', () => {
    expect(
      shouldAutoAccept(3600, ARTICLE, {
        autoAcceptOffersEnabled: true,
        autoAcceptThresholdPercent: null,
      }),
    ).toBe(false)
  })

  it('accepte au-dessus du seuil, une fois activée', () => {
    const policy = {
      autoAcceptOffersEnabled: true,
      autoAcceptThresholdPercent: 90,
    }

    // 90 % de 3800 = 3420.
    expect(shouldAutoAccept(3420, ARTICLE, policy)).toBe(true)
    expect(shouldAutoAccept(3419, ARTICLE, policy)).toBe(false)
  })

  it('ne franchit JAMAIS le prix plancher, quel que soit le seuil', () => {
    // Le garde-fou dur. Un seuil mal réglé — 50 % sur une pièce achetée cher —
    // ferait sinon vendre à perte, en série, sans que personne ne s'en
    // aperçoive avant le relevé. Une machine ne décide pas de vendre à perte.
    const policy = {
      autoAcceptOffersEnabled: true,
      autoAcceptThresholdPercent: 50,
    }

    // 50 % de 3800 font 1900 : 2200 franchit largement le seuil réglé, et
    // reste pourtant sous le plancher de 2340. C'est exactement le cas que le
    // garde-fou existe pour arrêter.
    expect(shouldAutoAccept(2200, ARTICLE, policy)).toBe(false)
    // Au plancher pile, elle passe : le plancher est atteint, pas franchi.
    expect(shouldAutoAccept(2340, ARTICLE, policy)).toBe(true)
  })

  it('pose la validité du prix quand elle accepte', () => {
    const verdict = evaluate(3600, {
      policy: {
        autoAcceptOffersEnabled: true,
        autoAcceptThresholdPercent: 90,
      },
    })

    expect(verdict).toEqual({
      ok: true,
      outcome: 'auto-accepted',
      expiresAt: new Date('2026-08-22T12:00:00.000Z'),
      priceValidUntil: new Date('2026-08-21T12:00:00.000Z'),
    })
  })
})

// ---------------------------------------------------------------------------
// Après acceptation
// ---------------------------------------------------------------------------

describe('prix négocié', () => {
  const accepted = {
    status: 'ACCEPTED',
    amountCents: 3000,
    priceValidUntil: new Date('2026-08-21T12:00:00.000Z'),
  }

  it('signale un franchissement de plancher sans l’interdire', () => {
    // Le vendeur a le droit de vendre à perte. Lui interdire reviendrait à
    // décider à sa place ; ne rien enregistrer rendrait la vente inexplicable
    // six mois plus tard.
    expect(isBelowFloor(2000, 2340)).toBe(true)
    expect(isBelowFloor(2340, 2340)).toBe(false)
  })

  it('n’est payable que tant qu’il est valable', () => {
    expect(isAcceptedPriceUsable(accepted, NOW)).toBe(true)
    expect(
      isAcceptedPriceUsable(accepted, new Date('2026-08-22T00:00:00.000Z')),
    ).toBe(false)
  })

  it('n’est payable que sur une offre ACCEPTÉE', () => {
    for (const status of ['PENDING', 'REJECTED', 'EXPIRED', 'CONSUMED']) {
      expect(isAcceptedPriceUsable({ ...accepted, status }, NOW), status).toBe(
        false,
      )
    }
  })

  it('n’est payable que si une échéance a été posée', () => {
    expect(
      isAcceptedPriceUsable({ ...accepted, priceValidUntil: null }, NOW),
    ).toBe(false)
  })

  it('facture le prix affiché sans offre utilisable', () => {
    expect(payablePriceCents(3800, null, NOW)).toBe(3800)
    expect(
      payablePriceCents(3800, { ...accepted, status: 'EXPIRED' }, NOW),
    ).toBe(3800)
  })

  it('facture le prix négocié quand il est utilisable', () => {
    expect(payablePriceCents(3800, accepted, NOW)).toBe(3000)
  })

  it('ne fait jamais payer PLUS cher pour avoir négocié', () => {
    // Une baisse automatique peut avoir amené le prix affiché sous le prix
    // négocié. Facturer alors le montant de l'offre punirait la négociation.
    expect(payablePriceCents(2500, accepted, NOW)).toBe(2500)
  })
})

// ---------------------------------------------------------------------------
// Où en est une négociation, du point de vue de l'acheteuse
// ---------------------------------------------------------------------------

describe('état affiché d’une offre', () => {
  const HOUR = 60 * 60 * 1000
  const later = new Date(NOW.getTime() + 6 * HOUR)
  const earlier = new Date(NOW.getTime() - 6 * HOUR)

  it('dit « en attente » tant que le délai de réponse court', () => {
    expect(
      offerStanding(
        { status: 'PENDING', expiresAt: later, priceValidUntil: null },
        NOW,
      ),
    ).toBe('awaiting')
  })

  it('dit « sans réponse » dès l’échéance passée, SANS attendre le balayage', () => {
    // Le cas qui impose la dérivation : `expireStaleOffers` tourne sur une
    // tâche planifiée, et une offre reste `PENDING` en base entre deux
    // passages. Lire le statut brut ferait attendre une réponse qui ne
    // viendra plus.
    expect(
      offerStanding(
        { status: 'PENDING', expiresAt: earlier, priceValidUntil: null },
        NOW,
      ),
    ).toBe('expired')
  })

  it('dit « payable » tant que le prix négocié vaut', () => {
    expect(
      offerStanding(
        { status: 'ACCEPTED', expiresAt: earlier, priceValidUntil: later },
        NOW,
      ),
    ).toBe('payable')
  })

  it('cesse de dire « acceptée » quand la validité est passée', () => {
    // Une offre reste `ACCEPTED` pour toujours en base. Continuer à l'annoncer
    // ainsi promettrait un prix que le panier ne fera pas — et c'est
    // exactement le prix que l'e-mail d'acceptation a promis, daté.
    expect(
      offerStanding(
        { status: 'ACCEPTED', expiresAt: earlier, priceValidUntil: earlier },
        NOW,
      ),
    ).toBe('lapsed')
  })

  it('n’annonce jamais « payable » sans échéance', () => {
    expect(
      offerStanding(
        { status: 'ACCEPTED', expiresAt: later, priceValidUntil: null },
        NOW,
      ),
    ).toBe('lapsed')
  })

  it('distingue le refus, la perte d’objet et l’usage', () => {
    // Les rabattre sur un « terminée » commun ferait lire un refus là où la
    // pièce est simplement partie — donc ouvrirait un délai de carence dans la
    // tête de quelqu'un qui n'a rien fait de mal.
    const rest = { expiresAt: earlier, priceValidUntil: null }
    expect(offerStanding({ status: 'REJECTED', ...rest }, NOW)).toBe('rejected')
    expect(offerStanding({ status: 'EXPIRED', ...rest }, NOW)).toBe('expired')
    expect(offerStanding({ status: 'VOIDED', ...rest }, NOW)).toBe('void')
    expect(offerStanding({ status: 'CONSUMED', ...rest }, NOW)).toBe('used')
    expect(offerStanding({ status: 'COUNTERED', ...rest }, NOW)).toBe('countered')
  })

  it('ne signale que ce qui appelle un geste', () => {
    expect(offerNeedsAttention('payable')).toBe(true)
    expect(offerNeedsAttention('countered')).toBe(true)

    for (const standing of ['awaiting', 'lapsed', 'rejected', 'expired', 'void', 'used'] as const) {
      expect(offerNeedsAttention(standing), standing).toBe(false)
    }
  })
})

describe('buyerMayAnswer', () => {
  const base = {
    status: 'PENDING' as const,
    parentOfferId: 'offre-mere',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
  }
  const avant = new Date('2026-08-25T00:00:00Z')

  it('accepte une contre-proposition en attente et non échue', () => {
    expect(buyerMayAnswer(base, avant)).toBe(true)
  })

  it('refuse une offre que l’acheteuse a déposée elle-même', () => {
    // Sans ce contrôle, l'identifiant de sa propre offre suffirait à
    // s'accorder son propre prix.
    expect(buyerMayAnswer({ ...base, parentOfferId: null }, avant)).toBe(false)
  })

  it('refuse une ligne déjà répondue', () => {
    for (const status of ['ACCEPTED', 'REJECTED', 'EXPIRED', 'VOIDED', 'CONSUMED', 'COUNTERED'] as const) {
      expect(buyerMayAnswer({ ...base, status }, avant), status).toBe(false)
    }
  })

  it('refuse une contre-proposition échue même si le statut dit « en attente »', () => {
    // Le balayage ne passe que toutes les cinq minutes : c'est l'échéance qui
    // fait foi. Sans cela, un bouton s'afficherait sur un geste que le serveur
    // refusera.
    const apres = new Date('2026-09-02T00:00:00Z')
    expect(buyerMayAnswer(base, apres)).toBe(false)
  })

  it('ne dit jamais oui là où offerStanding dit « contre-proposée »', () => {
    // Les deux lignes coexistent : celle qui PORTE l'état « countered » est
    // l'offre d'origine, close. Confondre les deux poserait les boutons sur la
    // mauvaise.
    const mere = { status: 'COUNTERED' as const, parentOfferId: null, expiresAt: base.expiresAt }
    expect(offerStanding({ ...mere, priceValidUntil: null }, avant)).toBe('countered')
    expect(buyerMayAnswer(mere, avant)).toBe(false)
  })
})
