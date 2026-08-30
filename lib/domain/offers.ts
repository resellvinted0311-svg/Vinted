import type { ArticleStatus, OfferStatus } from '@prisma/client'

import { isArticleListed } from '@/lib/db/visibility'

/**
 * Négociation — règles pures, sans base ni requête HTTP.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'une offre N'EST PAS
 * ---------------------------------------------------------------------------
 * Elle ne réserve rien. Le brief l'interdit en toutes lettres, et la raison
 * tient au stock : chaque pièce existe en un seul exemplaire. Immobiliser une
 * pièce pendant qu'on négocie, c'est la retirer de la vente pour quarante-huit
 * heures au bénéfice de quelqu'un qui n'a rien payé et qui, le plus souvent, ne
 * paiera pas.
 *
 * Conséquence assumée, et qu'il faut DIRE à l'acheteuse : une offre acceptée
 * peut ne plus avoir d'objet, parce que quelqu'un d'autre a payé le prix
 * affiché entre-temps. Le contraire — réserver — reviendrait à faire perdre des
 * ventes fermes pour des négociations ouvertes.
 *
 * ---------------------------------------------------------------------------
 * Le prix plancher est une garantie DURE, pas un avertissement
 * ---------------------------------------------------------------------------
 * `floorPriceCents` est le prix en dessous duquel une vente est déficitaire,
 * port et prélèvements compris (`lib/domain/pricing.ts`). Une acceptation
 * AUTOMATIQUE ne le franchit jamais, quel que soit le seuil réglé : une machine
 * n'a pas à décider de vendre à perte.
 *
 * Un humain, lui, le peut — c'est une décision commerciale, elle lui appartient.
 * Elle laisse alors une trace : `Offer.acceptedBelowFloor`.
 *
 * ---------------------------------------------------------------------------
 * L'acceptation automatique est DÉSACTIVÉE par défaut
 * ---------------------------------------------------------------------------
 * Le brief l'interdit comme comportement par défaut, et l'argument est celui du
 * prix affiché : si les acheteurs découvrent qu'une offre basse passe toute
 * seule, plus personne ne paie le prix demandé. Le réglage existe, il vaut
 * `false`, et ce module refuse de faire quoi que ce soit d'automatique sans
 * qu'il soit explicitement activé ET assorti d'un seuil.
 */

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export interface OfferPolicy {
  /** Plancher ABSOLU d'une offre, toutes pièces confondues. */
  minOfferAmountCents: number
  /** Combien d'offres une même personne peut déposer sur une même pièce. */
  maxOffersPerArticlePerUser: number
  /** Délai de carence après un refus, avant de pouvoir revenir. */
  offerCooldownAfterRejectionHours: number
  /** Temps laissé au vendeur pour répondre. */
  offerResponseHours: number
  /** Durée pendant laquelle un prix accepté reste payable. */
  acceptedOfferValidityHours: number
  /** Désactivée par défaut. Voir l'en-tête. */
  autoAcceptOffersEnabled: boolean
  /** Pourcentage du prix affiché à partir duquel une offre passerait seule. */
  autoAcceptThresholdPercent: number | null
}

// ---------------------------------------------------------------------------
// Faits
// ---------------------------------------------------------------------------

export interface OfferArticleFacts {
  status: ArticleStatus
  publishedAt: Date | null
  allowOffers: boolean
  /** Les offres n'ouvrent qu'après un délai depuis la mise en ligne. */
  offersOpenAt: Date | null
  priceCents: number
  /** Refus automatique en dessous de ce montant. Nul = pas de seuil. */
  minOfferCents: number | null
  /** PRIVÉ. Ne sort d'aucune réponse publique, y compris un message de refus. */
  floorPriceCents: number
}

export interface OfferHistoryFacts {
  /** Offres déjà déposées par cette personne sur cette pièce, refus compris. */
  attempts: number
  /** Une offre de cette personne attend-elle déjà une réponse ? */
  hasPending: boolean
  /** Dernier refus, pour le délai de carence. */
  lastRejectedAt: Date | null
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * Motifs de refus D'ENREGISTREMENT — l'offre n'est pas déposée du tout.
 *
 * À distinguer d'un refus de l'offre elle-même : celle-là est bien enregistrée,
 * elle porte une trace, elle compte dans les tentatives et elle ouvre un délai
 * de carence. Confondre les deux ferait disparaître des offres sans qu'aucune
 * histoire ne les explique.
 */
export type OfferRejection =
  | 'offers-disabled'
  | 'offers-not-open-yet'
  | 'article-unavailable'
  | 'below-absolute-minimum'
  | 'not-below-asking-price'
  | 'already-pending'
  | 'too-many-attempts'
  | 'cooldown'

export type OfferOutcome =
  /** Enregistrée, elle attend une réponse humaine. */
  | 'pending'
  /** Enregistrée et refusée sur-le-champ : sous le minimum de la pièce. */
  | 'auto-rejected'
  /** Enregistrée et acceptée sur-le-champ. Jamais sous le plancher. */
  | 'auto-accepted'

export type OfferVerdict =
  | {
      ok: false
      rejection: OfferRejection
      /**
       * Quand la personne pourra réessayer — ouverture des offres, fin de
       * carence. Absent quand la réponse ne dépend pas du temps.
       */
      retryAt?: Date
    }
  | {
      ok: true
      outcome: OfferOutcome
      /** Échéance de réponse, posée dès le dépôt. */
      expiresAt: Date
      /** Validité du prix, sur une acceptation seulement. */
      priceValidUntil?: Date
    }

const HOUR_MS = 60 * 60 * 1000

function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * HOUR_MS)
}

/**
 * Une offre peut-elle être déposée, et que devient-elle immédiatement ?
 *
 * L'ordre des contrôles n'est pas indifférent : on répond d'abord ce qui ne
 * dépend pas du montant. Dire « votre offre est trop basse » sur une pièce
 * déjà vendue ferait proposer plus cher pour rien.
 */
export function evaluateOffer(input: {
  amountCents: number
  article: OfferArticleFacts
  history: OfferHistoryFacts
  policy: OfferPolicy
  now: Date
}): OfferVerdict {
  const { amountCents, article, history, policy, now } = input

  // ---- L'état de la pièce ------------------------------------------------
  if (!article.allowOffers) {
    return { ok: false, rejection: 'offers-disabled' }
  }

  // RESERVED est écarté par `isArticleListed` ? Non : une pièce réservée reste
  // listée, parce que la réservation dure quelques minutes et expire le plus
  // souvent. Mais elle n'accepte pas d'offre : quelqu'un est à l'étape du
  // paiement, carte en main, et négocier par-dessus n'aurait aucun sens.
  const listed = isArticleListed(
    { status: article.status, publishedAt: article.publishedAt },
    now,
  )
  if (!listed || article.status === 'RESERVED') {
    return { ok: false, rejection: 'article-unavailable' }
  }

  // ---- La fenêtre --------------------------------------------------------
  //
  // Une pièce négociable dès la première heure ne se vend jamais au prix
  // affiché : il suffit d'attendre. Le délai laisse au prix demandé le temps
  // d'exister.
  if (article.offersOpenAt && article.offersOpenAt > now) {
    return {
      ok: false,
      rejection: 'offers-not-open-yet',
      retryAt: article.offersOpenAt,
    }
  }

  // ---- L'historique de cette personne ------------------------------------
  if (history.hasPending) {
    // Empiler les offres permettrait de faire monter les enchères contre
    // soi-même, et de noyer le vendeur sous des propositions qui se
    // contredisent.
    return { ok: false, rejection: 'already-pending' }
  }

  if (history.attempts >= policy.maxOffersPerArticlePerUser) {
    return { ok: false, rejection: 'too-many-attempts' }
  }

  if (history.lastRejectedAt) {
    const openAgainAt = addHours(
      history.lastRejectedAt,
      policy.offerCooldownAfterRejectionHours,
    )
    if (openAgainAt > now) {
      // Sans carence, un refus se contourne en renvoyant la même offre à un
      // centime près, indéfiniment.
      return { ok: false, rejection: 'cooldown', retryAt: openAgainAt }
    }
  }

  // ---- Le montant --------------------------------------------------------
  if (amountCents < policy.minOfferAmountCents) {
    return { ok: false, rejection: 'below-absolute-minimum' }
  }

  if (amountCents >= article.priceCents) {
    // Ce n'est pas une offre, c'est un achat. L'enregistrer ferait attendre
    // quarante-huit heures une réponse à une question qui n'en est pas une,
    // pendant lesquelles la pièce peut partir.
    return { ok: false, rejection: 'not-below-asking-price' }
  }

  const expiresAt = addHours(now, policy.offerResponseHours)

  // ---- Refus automatique -------------------------------------------------
  //
  // ENREGISTRÉ, et refusé. Pas « non déposé » : la personne a proposé quelque
  // chose, elle mérite une réponse et une trace, et cette tentative compte.
  if (article.minOfferCents !== null && amountCents < article.minOfferCents) {
    return { ok: true, outcome: 'auto-rejected', expiresAt }
  }

  // ---- Acceptation automatique -------------------------------------------
  if (shouldAutoAccept(amountCents, article, policy)) {
    return {
      ok: true,
      outcome: 'auto-accepted',
      expiresAt,
      priceValidUntil: addHours(now, policy.acceptedOfferValidityHours),
    }
  }

  return { ok: true, outcome: 'pending', expiresAt }
}

/**
 * Une machine accepte-t-elle cette offre toute seule ?
 *
 * Trois conditions, et il faut les trois. La dernière est la seule qui ne se
 * règle pas : une acceptation automatique ne franchit JAMAIS le prix plancher,
 * quel que soit le seuil configuré. Un seuil mal réglé — 50 % du prix affiché
 * sur une pièce achetée cher — ferait sinon vendre à perte, en série, sans que
 * personne ne s'en aperçoive avant le relevé.
 */
export function shouldAutoAccept(
  amountCents: number,
  article: Pick<OfferArticleFacts, 'priceCents' | 'floorPriceCents'>,
  policy: Pick<
    OfferPolicy,
    'autoAcceptOffersEnabled' | 'autoAcceptThresholdPercent'
  >,
): boolean {
  if (!policy.autoAcceptOffersEnabled) return false

  const percent = policy.autoAcceptThresholdPercent
  if (percent === null) return false

  // Le seuil est un pourcentage du prix affiché. Le produit se fait en entiers
  // pour la même raison que partout ailleurs : aucun flottant dans un calcul
  // qui décide d'un encaissement.
  const threshold = Math.ceil((article.priceCents * percent) / 100)
  if (amountCents < threshold) return false

  return amountCents >= article.floorPriceCents
}

/**
 * Une acceptation manuelle franchit-elle le plancher ?
 *
 * Ne bloque rien : le vendeur a le droit de vendre à perte, et lui interdire
 * reviendrait à décider à sa place. Mais la réponse est enregistrée sur
 * l'offre, pour qu'une vente déficitaire reste explicable six mois plus tard.
 */
export function isBelowFloor(
  amountCents: number,
  floorPriceCents: number,
): boolean {
  return amountCents < floorPriceCents
}

/**
 * Le prix négocié est-il encore payable ?
 *
 * Une offre acceptée ne vaut pas indéfiniment : sans échéance, une pièce
 * resterait négociée à un prix décidé il y a six mois, sur une grille de port
 * et un coût d'achat qui ont changé depuis.
 */
export function isAcceptedPriceUsable(
  offer: { status: string; priceValidUntil: Date | null },
  now = new Date(),
): boolean {
  if (offer.status !== 'ACCEPTED') return false
  if (offer.priceValidUntil === null) return false
  return offer.priceValidUntil > now
}

/**
 * Montant réellement dû pour une pièce, offre acceptée comprise.
 *
 * Le prix négocié ne s'applique que s'il est encore valable ET s'il est
 * inférieur au prix affiché. La seconde condition n'est pas de la méfiance
 * envers l'acheteuse — elle ne choisit pas ce montant — mais envers le temps :
 * une baisse automatique peut avoir amené le prix affiché SOUS le prix
 * négocié, et facturer alors le prix négocié ferait payer plus cher pour avoir
 * négocié.
 */
export function payablePriceCents(
  articlePriceCents: number,
  offer: { status: string; amountCents: number; priceValidUntil: Date | null } | null,
  now = new Date(),
): number {
  if (!offer || !isAcceptedPriceUsable(offer, now)) return articlePriceCents
  return Math.min(offer.amountCents, articlePriceCents)
}

// ---------------------------------------------------------------------------
// Où en est une négociation, du point de vue de l'acheteuse
// ---------------------------------------------------------------------------

/**
 * L'état d'une offre TEL QU'IL EST À CET INSTANT.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `Offer.status` ne suffit pas à l'afficher
 * ---------------------------------------------------------------------------
 * Deux colonnes portent une échéance, et aucune ne se met à jour toute seule :
 *
 *  - `expiresAt` : une offre reste `PENDING` en base jusqu'à ce que le balayage
 *    (`expireStaleOffers`, appelé par une tâche planifiée) passe. Entre deux
 *    passages, afficher « en attente de réponse » sur une offre dont le délai
 *    est écoulé ferait attendre une réponse qui ne viendra plus.
 *
 *  - `priceValidUntil` : une offre reste `ACCEPTED` pour toujours, mais le prix
 *    n'est payable que pendant sa fenêtre de validité. Afficher « acceptée »
 *    au-delà promettrait un prix que le panier ne fera pas — et c'est
 *    exactement la promesse que l'e-mail d'acceptation a faite, datée.
 *
 * Les deux dérivations sont ici, pures, plutôt que dans le composant : c'est la
 * même règle qui décide de ce qu'on affiche et de ce qu'on facture, et la
 * dupliquer dans une vue est le moyen le plus sûr de les faire diverger.
 */
export type OfferStanding =
  /** Déposée, le délai de réponse court encore. */
  | 'awaiting'
  /** La boutique a répondu par une contre-proposition. */
  | 'countered'
  /** Acceptée, et le prix est encore payable. */
  | 'payable'
  /** Acceptée, mais la validité du prix est passée. */
  | 'lapsed'
  /** Refusée — automatiquement ou par le vendeur. */
  | 'rejected'
  /** Restée sans réponse au-delà du délai. */
  | 'expired'
  /** Sans objet : la pièce est partie avant la réponse. */
  | 'void'
  /** A servi à fixer le prix d'un achat. */
  | 'used'

export function offerStanding(
  offer: {
    status: OfferStatus
    expiresAt: Date
    priceValidUntil: Date | null
  },
  now = new Date(),
): OfferStanding {
  switch (offer.status) {
    case 'PENDING':
      // Le balayage n'est pas encore passé : c'est l'échéance qui fait foi.
      return offer.expiresAt <= now ? 'expired' : 'awaiting'
    case 'ACCEPTED':
      return isAcceptedPriceUsable(offer, now) ? 'payable' : 'lapsed'
    case 'COUNTERED':
      return 'countered'
    case 'REJECTED':
      return 'rejected'
    case 'EXPIRED':
      return 'expired'
    case 'VOIDED':
      return 'void'
    case 'CONSUMED':
      return 'used'
  }
}

/**
 * Cette négociation attend-elle un geste de l'acheteuse ?
 *
 * Sert à remonter en tête de liste ce qui a une échéance : un prix payable qui
 * expire ce soir et un refus d'il y a trois semaines n'ont pas à se disputer la
 * même place.
 */
export function offerNeedsAttention(standing: OfferStanding): boolean {
  return standing === 'payable' || standing === 'countered'
}

/**
 * L'acheteuse peut-elle répondre à cette ligne ?
 *
 * ---------------------------------------------------------------------------
 * Deux lignes pour une seule négociation, et une seule est actionnable
 * ---------------------------------------------------------------------------
 * Quand la boutique contre-propose, deux lignes coexistent : l'offre d'origine,
 * passée en `COUNTERED`, et la contre-proposition, créée en `PENDING` avec
 * `parentOfferId` renseigné. La première raconte ce qui s'est passé ; c'est la
 * seconde qui attend un geste.
 *
 * Confondre les deux est l'erreur naturelle — `offerStanding` rend « countered »
 * pour la PREMIÈRE — et elle donnerait des boutons sur une ligne close, aucun
 * sur celle qui compte.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi l'échéance est relue ici
 * ---------------------------------------------------------------------------
 * Le balayage ne passe que par intermittence. Une contre-proposition
 * échue il y a trois minutes porte encore `PENDING` en base : afficher un
 * bouton dessus ferait cliquer sur un geste que le serveur refusera.
 */
export function buyerMayAnswer(
  offer: {
    status: OfferStatus
    parentOfferId: string | null
    expiresAt: Date
  },
  now = new Date(),
): boolean {
  if (offer.parentOfferId === null) return false
  if (offer.status !== 'PENDING') return false
  return offer.expiresAt > now
}
