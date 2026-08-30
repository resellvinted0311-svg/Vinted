import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { getOfferPolicy } from '@/lib/config/settings'
import { enqueue } from '@/lib/jobs/queue'
import { SITE } from '@/lib/config/site'
import type { OfferEmailData } from '@/lib/providers/email/offer'
import {
  evaluateOffer,
  isBelowFloor,
  type OfferPolicy,
  type OfferRejection,
  type OfferVerdict,
} from '@/lib/domain/offers'

/**
 * Négociation — persistance.
 *
 * Le domaine (`lib/domain/offers.ts`) décide ; ce module écrit. La séparation
 * n'est pas décorative : toutes les règles de bornage — carence, plafond de
 * tentatives, fenêtre d'ouverture, garde-fou du plancher — sont exercées sans
 * base de données, et ce fichier ne fait que leur donner des faits.
 *
 * ---------------------------------------------------------------------------
 * Une offre ne verrouille RIEN
 * ---------------------------------------------------------------------------
 * Aucune fonction de ce fichier ne touche `Article.status`, `reservedById` ni
 * `reservedUntil`. C'est une interdiction du brief, et sa raison tient au
 * stock unitaire : immobiliser une pièce quarante-huit heures au bénéfice de
 * quelqu'un qui n'a rien payé fait perdre des ventes fermes.
 *
 * ---------------------------------------------------------------------------
 * L'identité d'une offre
 * ---------------------------------------------------------------------------
 * Compte quand il y en a un, jeton de session boutique sinon — exactement le
 * modèle du panier et de la commande. Une offre sans compte porte en plus une
 * adresse e-mail, sans quoi la réponse n'atteindrait personne.
 *
 * Ce que cela ne protège pas, et qu'il faut dire : les compteurs de carence et
 * de tentatives tiennent à une identité qu'on peut renouveler en effaçant un
 * cookie. C'est la même faiblesse que celle du panier invité, acceptée pour la
 * même raison — exiger un compte pour proposer un prix ferait perdre plus de
 * négociations que l'abus n'en coûte. La limitation de débit par adresse, en
 * amont, reste le vrai frein.
 */

// ---------------------------------------------------------------------------
// Identité
// ---------------------------------------------------------------------------

export interface OfferOwner {
  userId: string | null
  /** Jeton de session boutique. Identifie une offre déposée sans compte. */
  sessionToken: string
  /** Obligatoire sans compte : c'est par là que la réponse arrive. */
  email: string | null
}

/**
 * Clause Prisma désignant les offres de CETTE personne.
 *
 * Sans compte, l'appariement se fait sur le jeton de session ET l'adresse.
 * Le jeton seul laisserait deux personnes d'un même navigateur partagé se voir
 * l'une l'autre ; l'adresse seule laisserait n'importe qui compter les offres
 * de quelqu'un d'autre en devinant son e-mail.
 */
function ownerWhere(owner: OfferOwner): Prisma.OfferWhereInput {
  if (owner.userId) return { userId: owner.userId }

  return {
    userId: null,
    guestSessionToken: owner.sessionToken,
    ...(owner.email ? { guestEmail: owner.email } : {}),
  }
}

// ---------------------------------------------------------------------------
// Dépôt
// ---------------------------------------------------------------------------

export type SubmitOfferResult =
  | { ok: false; rejection: OfferRejection | 'article-unknown'; retryAt?: Date }
  | {
      ok: true
      offerId: string
      /** `pending`, `auto-rejected` ou `auto-accepted`. */
      outcome: Extract<OfferVerdict, { ok: true }>['outcome']
      expiresAt: Date
      priceValidUntil: Date | null
    }

/**
 * Dépose une offre.
 *
 * ---------------------------------------------------------------------------
 * Tout tient dans une transaction, et l'article est relu DEDANS
 * ---------------------------------------------------------------------------
 * Entre la lecture de la pièce et l'écriture de l'offre, la pièce peut être
 * vendue. Relire hors transaction reviendrait à juger sur un état périmé et à
 * enregistrer une offre sur une pièce partie — que le vendeur découvrirait en
 * essayant de l'accepter.
 *
 * ---------------------------------------------------------------------------
 * Le refus automatique est ENREGISTRÉ
 * ---------------------------------------------------------------------------
 * Une offre sous le minimum de la pièce est écrite, avec son motif, puis
 * refusée. Ne rien écrire ferait disparaître la proposition sans trace : la
 * personne n'aurait pas de réponse, la tentative ne compterait pas, et la
 * carence ne s'ouvrirait pas — donc le refus se contournerait en boucle.
 */
export async function submitOffer(input: {
  articleId: string
  amountCents: number
  owner: OfferOwner
  now?: Date
  policy?: OfferPolicy
}): Promise<SubmitOfferResult> {
  const now = input.now ?? new Date()
  const policy = input.policy ?? (await getOfferPolicy())

  return prisma.$transaction(async (tx) => {
    const article = await tx.article.findUnique({
      where: { id: input.articleId },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        allowOffers: true,
        offersOpenAt: true,
        priceCents: true,
        minOfferCents: true,
        floorPriceCents: true,
      },
    })

    if (!article) return { ok: false as const, rejection: 'article-unknown' as const }

    const mine = ownerWhere(input.owner)

    const [attempts, pending, lastRejected] = await Promise.all([
      // `parentOfferId: null` : on compte ce que CETTE personne a proposé de
      // sa propre initiative, pas les contre-offres que le vendeur lui a
      // adressées.
      //
      // Elles portent pourtant la même identité — il faut bien qu'elle puisse
      // les voir et y répondre. Les compter dans son plafond ferait payer à
      // l'acheteuse la volonté de négocier du vendeur : trois allers-retours
      // proposés par la boutique, et la personne n'a plus le droit de rien
      // proposer sur cette pièce.
      tx.offer.count({
        where: { articleId: article.id, parentOfferId: null, ...mine },
      }),
      // Toutes les offres en attente, contre-offres comprises : une
      // contre-offre qui attend une réponse doit empêcher d'en déposer une
      // nouvelle, sinon on l'ignore et l'on repropose plus bas.
      tx.offer.count({
        where: { articleId: article.id, status: 'PENDING', ...mine },
      }),
      // `parentOfferId: null`, comme pour le compteur de tentatives, et pour
      // la même raison — mais le défaut évité est ici plus rude.
      //
      // La carence existe pour qu'un REFUS ne se contourne pas en renvoyant la
      // même offre à un centime près. Sans ce prédicat, une contre-proposition
      // que l'acheteuse DÉCLINE porte elle aussi `REJECTED`, et déclenche donc
      // la carence : elle serait punie d'avoir dit non à une proposition que le
      // vendeur lui a faite. Elle n'a rien demandé, et se retrouve interdite de
      // proposer pendant des heures.
      tx.offer.findFirst({
        where: {
          articleId: article.id,
          status: 'REJECTED',
          parentOfferId: null,
          ...mine,
        },
        orderBy: { respondedAt: 'desc' },
        select: { respondedAt: true },
      }),
    ])

    const verdict = evaluateOffer({
      amountCents: input.amountCents,
      article,
      history: {
        attempts,
        hasPending: pending > 0,
        lastRejectedAt: lastRejected?.respondedAt ?? null,
      },
      policy,
      now,
    })

    if (!verdict.ok) {
      return {
        ok: false as const,
        rejection: verdict.rejection,
        ...(verdict.retryAt ? { retryAt: verdict.retryAt } : {}),
      }
    }

    const accepted = verdict.outcome === 'auto-accepted'
    const rejected = verdict.outcome === 'auto-rejected'

    const offer = await tx.offer.create({
      data: {
        articleId: article.id,
        userId: input.owner.userId,
        guestEmail: input.owner.userId ? null : input.owner.email,
        guestSessionToken: input.owner.userId ? null : input.owner.sessionToken,
        amountCents: input.amountCents,
        status: accepted ? 'ACCEPTED' : rejected ? 'REJECTED' : 'PENDING',
        expiresAt: verdict.expiresAt,
        priceValidUntil: verdict.priceValidUntil ?? null,
        respondedAt: accepted || rejected ? now : null,
        rejectionReason: rejected ? 'AUTO_BELOW_MIN' : null,
        // Une acceptation automatique ne franchit jamais le plancher — le
        // domaine s'y refuse. Le champ reste donc faux, et ce n'est pas une
        // supposition : c'est la seule valeur qu'il puisse prendre ici.
        acceptedBelowFloor: false,
      },
      select: { id: true },
    })

    // L'accusé est INSCRIT, pas envoyé : un appel réseau dans une transaction
    // tiendrait des verrous en attendant un tiers, et un message parti ne se
    // rembobine pas si la transaction échoue ensuite.
    //
    // Il part dans les trois cas. Sans lui, une personne sans compte n'a plus
    // aucune trace de ce qu'elle a proposé une fois l'onglet fermé — ni du
    // montant, ni de la date à laquelle une réponse est due.
    await enqueue(tx, {
      type: 'offer.acknowledge',
      payload: { offerId: offer.id },
    })

    // La boutique n'est prévenue que de ce qui attend une décision. Une offre
    // tranchée sur-le-champ n'appelle aucun geste, et l'annoncer noierait les
    // avis qui, eux, expirent en quarante-huit heures faute de réponse.
    if (!accepted && !rejected) {
      await enqueue(tx, {
        type: 'offer.notify-shop',
        payload: { offerId: offer.id },
      })
    }

    return {
      ok: true as const,
      offerId: offer.id,
      outcome: verdict.outcome,
      expiresAt: verdict.expiresAt,
      priceValidUntil: verdict.priceValidUntil ?? null,
    }
  })
}

/**
 * Relit une offre sous la forme qu'attendent les gabarits d'e-mail.
 *
 * Relue et non transportée : la charge utile du travail ne porte qu'un
 * identifiant. Recopier le montant et l'adresse au moment de l'inscription les
 * figerait deux fois, et les deux copies finiraient par diverger — une
 * acceptation qui tombe entre l'inscription et l'envoi, par exemple.
 */
export async function readOfferEmailData(
  offerId: string,
  locale = 'fr',
): Promise<OfferEmailData | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      amountCents: true,
      status: true,
      expiresAt: true,
      priceValidUntil: true,
      counterAmountCents: true,
      guestEmail: true,
      user: { select: { email: true, locale: true } },
      /**
       * La contre-proposition émise, quand il y en a une.
       *
       * On la lit pour son ÉCHÉANCE : celle de l'offre d'origine est celle du
       * délai de réponse du vendeur, déjà consommé. Annoncer cette date-là à
       * l'acheteuse lui donnerait pour répondre un délai qui vient d'expirer.
       */
      counters: {
        select: { expiresAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      article: {
        select: {
          sku: true,
          slug: true,
          translations: {
            where: { locale: { in: [locale, 'fr'] } },
            select: { locale: true, title: true },
          },
        },
      },
    },
  })

  if (!offer) return null

  // Sans destinataire, il n'y a rien à envoyer — et rien à réessayer.
  const email = offer.user?.email ?? offer.guestEmail
  if (!email) return null

  const language = offer.user?.locale ?? locale
  const title =
    offer.article.translations.find((row) => row.locale === language)?.title ??
    offer.article.translations.find((row) => row.locale === 'fr')?.title ??
    offer.article.sku

  // ---------------------------------------------------------------------------
  // `COUNTERED` n'est PAS un refus, et le confondre était un mensonge
  // ---------------------------------------------------------------------------
  // La forme précédente rabattait tout ce qui n'était ni accepté ni en attente
  // sur « refusée ». Une contre-proposition serait donc annoncée à l'acheteuse
  // comme un refus, au moment précis où la boutique lui propose un prix. Elle
  // aurait lu « votre offre a été refusée » puis trouvé, dans son espace
  // compte, une proposition en attente de sa réponse.
  const outcome =
    offer.status === 'ACCEPTED'
      ? ('accepted' as const)
      : offer.status === 'PENDING'
        ? ('pending' as const)
        : offer.status === 'COUNTERED'
          ? ('countered' as const)
          : ('rejected' as const)

  return {
    locale: language,
    email,
    reference: offer.article.sku,
    title,
    amountCents: offer.amountCents,
    outcome,
    counterAmountCents: offer.counterAmountCents,
    // Sur une contre-proposition, l'échéance qui compte est celle de la
    // proposition elle-même, pas celle de l'offre d'origine.
    expiresAt:
      outcome === 'countered'
        ? (offer.counters[0]?.expiresAt ?? offer.expiresAt)
        : offer.expiresAt,
    priceValidUntil: offer.priceValidUntil,
    url: `${SITE.url}/${language}/a/${offer.article.slug}`,
  }
}

// ---------------------------------------------------------------------------
// Réponse du vendeur
// ---------------------------------------------------------------------------

export type OfferResponse =
  | { action: 'accept' }
  | { action: 'reject' }
  | {
      action: 'counter'
      counterAmountCents: number
      /**
       * Le vendeur assume de proposer sous son propre prix plancher.
       *
       * Le domaine autorise la vente à perte — c'est une décision commerciale —
       * mais exige qu'elle soit prise en connaissance de cause et laisse une
       * trace. Sans ce garde-fou, `respondToOffer` ne comparait la contre-offre
       * à RIEN : la boutique pouvait proposer elle-même un prix déficitaire,
       * l'acheteuse l'accepter, et `acceptedBelowFloor` rester faux — la
       * colonne prévue pour garder cette trace n'aurait rien gardé.
       */
      confirmBelowFloor?: boolean
    }

export type RespondResult =
  | {
      ok: false
      reason:
        | 'not-found'
        | 'not-pending'
        | 'article-unavailable'
        | 'invalid-counter'
        /**
         * Contre-proposition demandée sur une offre déposée SANS COMPTE.
         *
         * Voir l'en-tête de `respondToOffer` : une invitée n'a aucun écran où
         * répondre, et lui adresser une contre-proposition la bloquerait sur
         * cette pièce jusqu'à l'échéance.
         */
        | 'counter-needs-account'
        /** Contre-offre sous le prix plancher, sans déclaration explicite. */
        | 'counter-below-floor'
    }
  | {
      ok: true
      status: 'ACCEPTED' | 'REJECTED' | 'COUNTERED'
      /** Vrai quand le vendeur a franchi le plancher en connaissance de cause. */
      belowFloor: boolean
      priceValidUntil: Date | null
      /** Sur une contre-offre : la nouvelle offre, en attente côté acheteur. */
      counterOfferId?: string
    }

/**
 * Le vendeur répond à une offre.
 *
 * ---------------------------------------------------------------------------
 * La transition est CONDITIONNELLE
 * ---------------------------------------------------------------------------
 * `WHERE status = 'PENDING'` dans l'écriture, jamais un `findUnique` suivi
 * d'un `update`. Le cas qui l'impose : le balayage des offres échues et le
 * clic du vendeur tombent au même instant. Sans prédicat, l'un écrase l'autre
 * et l'offre finit acceptée ET expirée.
 *
 * ---------------------------------------------------------------------------
 * Accepter ne réserve pas la pièce
 * ---------------------------------------------------------------------------
 * Elle reste en vente au prix affiché jusqu'à ce que quelqu'un paie. Le prix
 * négocié est une PROMESSE DE PRIX bornée dans le temps, pas une mise de côté.
 * L'interface doit le dire ; le code, lui, se contente de ne rien verrouiller.
 */
export async function respondToOffer(input: {
  offerId: string
  response: OfferResponse
  now?: Date
  policy?: OfferPolicy
}): Promise<RespondResult> {
  const now = input.now ?? new Date()
  const policy = input.policy ?? (await getOfferPolicy())

  return prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUnique({
      where: { id: input.offerId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        articleId: true,
        userId: true,
        guestEmail: true,
        guestSessionToken: true,
        article: {
          select: {
            status: true,
            publishedAt: true,
            priceCents: true,
            floorPriceCents: true,
          },
        },
      },
    })

    if (!offer) return { ok: false as const, reason: 'not-found' as const }
    if (offer.status !== 'PENDING') {
      return { ok: false as const, reason: 'not-pending' as const }
    }

    // Une pièce vendue entre-temps ne se négocie plus. Le vendeur doit le
    // voir comme un refus d'agir, pas comme une acceptation sans effet.
    if (offer.article.status === 'SOLD') {
      return { ok: false as const, reason: 'article-unavailable' as const }
    }

    if (input.response.action === 'counter') {
      const amount = input.response.counterAmountCents

      // ---------------------------------------------------------------------
      // Sans compte, pas de contre-proposition — et c'est ce qui ferme le piège
      // ---------------------------------------------------------------------
      // Une contre-proposition crée une offre EN ATTENTE au nom de l'acheteuse.
      // Tant qu'elle attend, `already-pending` lui interdit d'en déposer une
      // autre sur cette pièce. C'est correct — à condition qu'elle puisse y
      // répondre.
      //
      // Or le registre des offres vit sous `/compte`. Une personne qui a
      // négocié sans compte n'a aucun écran où voir la proposition, donc aucun
      // moyen de l'accepter ni de la décliner : elle serait bloquée jusqu'à
      // l'échéance pour avoir négocié. Lui ouvrir ce chemin demanderait une
      // page publique porteuse d'un jeton signé — une surface entière, avec ses
      // propres questions d'énumération et de rejeu.
      //
      // On refuse donc franchement plutôt que de livrer une moitié de chemin.
      if (!offer.userId) {
        return { ok: false as const, reason: 'counter-needs-account' as const }
      }

      // Une contre-offre au-dessus du prix affiché n'en est pas une, et une
      // contre-offre sous l'offre reçue reviendrait à négocier contre soi.
      if (amount <= offer.amountCents || amount >= offer.article.priceCents) {
        return { ok: false as const, reason: 'invalid-counter' as const }
      }

      // Le plancher est relu EN BASE, dans la transaction : un montant de
      // référence qui traverse le navigateur est un montant qu'on réécrit.
      if (
        isBelowFloor(amount, offer.article.floorPriceCents) &&
        !input.response.confirmBelowFloor
      ) {
        return { ok: false as const, reason: 'counter-below-floor' as const }
      }
    }

    const status =
      input.response.action === 'accept'
        ? 'ACCEPTED'
        : input.response.action === 'reject'
          ? 'REJECTED'
          : 'COUNTERED'

    const belowFloor =
      input.response.action === 'accept' &&
      isBelowFloor(offer.amountCents, offer.article.floorPriceCents)

    const priceValidUntil =
      input.response.action === 'accept'
        ? new Date(
            now.getTime() + policy.acceptedOfferValidityHours * 60 * 60 * 1000,
          )
        : null

    const moved = await tx.$executeRaw`
      UPDATE "Offer"
      SET "status" = ${status}::"OfferStatus",
          "respondedAt" = ${now},
          "priceValidUntil" = ${priceValidUntil},
          "acceptedBelowFloor" = ${belowFloor},
          "rejectionReason" = ${input.response.action === 'reject' ? 'MANUAL' : null},
          "counterAmountCents" = ${
            input.response.action === 'counter'
              ? input.response.counterAmountCents
              : null
          },
          "updatedAt" = now()
      WHERE "id" = ${offer.id}
        AND "status" = 'PENDING'
    `

    // Zéro ligne : quelqu'un d'autre — le balayage, un second onglet — a fait
    // la transition entre la lecture et l'écriture.
    if (moved === 0) {
      return { ok: false as const, reason: 'not-pending' as const }
    }

    // Une contre-offre est une NOUVELLE offre, chaînée à la précédente, et
    // c'est l'acheteuse qui doit maintenant répondre. La modéliser comme un
    // simple champ sur l'offre reçue perdrait l'historique de la négociation —
    // et l'on ne saurait plus qui a proposé quoi.
    let counterOfferId: string | undefined
    if (input.response.action === 'counter') {
      const counter = await tx.offer.create({
        data: {
          articleId: offer.articleId,
          userId: offer.userId,
          guestEmail: offer.guestEmail,
          guestSessionToken: offer.guestSessionToken,
          amountCents: input.response.counterAmountCents,
          status: 'PENDING',
          parentOfferId: offer.id,
          expiresAt: new Date(
            now.getTime() + policy.offerResponseHours * 60 * 60 * 1000,
          ),
        },
        select: { id: true },
      })
      counterOfferId = counter.id
    }

    // -------------------------------------------------------------------------
    // Prévenir l'acheteuse — ce qui manquait, et rendait la réponse muette
    // -------------------------------------------------------------------------
    // Sans cette inscription, `respondToOffer` acceptait une offre, posait une
    // échéance de validité du prix, et personne n'était prévenu. L'acheteuse
    // avait vingt-quatre heures pour payer un prix dont elle n'apprenait jamais
    // qu'il lui était accordé. Un refus était tout aussi silencieux : elle
    // attendait une réponse déjà donnée, sans pouvoir reproposer puisque
    // l'offre n'était plus en attente.
    //
    // INSCRIT dans la transaction, comme partout ailleurs : un e-mail parti ne
    // se rembobine pas si l'écriture échoue ensuite, et un appel réseau tenu
    // dans une transaction garderait des verrous en attendant un tiers.
    //
    // La contre-proposition part elle aussi, désormais.
    //
    // Elle était écartée tant que son gabarit disait « refusée » : annoncer un
    // refus au moment précis où l'on propose un prix aurait été pire que le
    // silence. `readOfferEmailData` distingue maintenant `COUNTERED`, et le
    // message porte le montant proposé et la date avant laquelle répondre.
    await enqueue(tx, {
      type: 'offer.respond',
      payload: { offerId: offer.id },
    })

    return {
      ok: true as const,
      status,
      belowFloor,
      priceValidUntil,
      ...(counterOfferId ? { counterOfferId } : {}),
    }
  })
}

// ---------------------------------------------------------------------------
// Réponse de l'acheteuse à une contre-proposition
// ---------------------------------------------------------------------------

export type CounterAnswer = 'accept' | 'decline'

export type AnswerCounterResult =
  | {
      ok: false
      reason:
        /** Aucune ligne de ce nom, ou elle ne lui appartient pas. */
        | 'not-found'
        /** Ce n'est pas une contre-proposition mais une offre qu'elle a faite. */
        | 'not-a-counter'
        /** Déjà répondue, ou éteinte par le balayage entre-temps. */
        | 'not-pending'
        /** Le délai de réponse est passé. */
        | 'expired'
        /** La pièce est partie avant qu'elle ne réponde. */
        | 'article-unavailable'
    }
  | { ok: true; accepted: boolean; priceValidUntil: Date | null }

/**
 * L'acheteuse accepte ou décline la contre-proposition de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce chemin vient ouvrir, et le piège qu'il referme
 * ---------------------------------------------------------------------------
 * `respondToOffer` savait émettre une contre-proposition depuis le premier
 * jour. Rien ne permettait d'y répondre. Le résultat aurait été le contraire du
 * but recherché : la contre-proposition est une offre EN ATTENTE au nom de
 * l'acheteuse, et `already-pending` lui interdit d'en déposer une autre tant
 * qu'elle attend. Elle se serait retrouvée bloquée sur cette pièce, pour avoir
 * négocié, sans aucun moyen d'en sortir avant l'échéance.
 *
 * C'est la raison pour laquelle le lot précédent n'a PAS exposé la
 * contre-proposition côté vendeur. Les deux côtés existent maintenant, ou
 * aucun.
 *
 * ---------------------------------------------------------------------------
 * La portée vient du COMPTE, jamais de l'identifiant reçu
 * ---------------------------------------------------------------------------
 * Un identifiant d'offre suffirait sinon à accepter — donc à rendre payable —
 * le prix négocié par quelqu'un d'autre. La lecture est bornée à
 * `userId`, et l'écriture porte le même prédicat.
 *
 * ---------------------------------------------------------------------------
 * Accepter ne réserve toujours rien
 * ---------------------------------------------------------------------------
 * Comme pour une offre acceptée par le vendeur : le prix devient payable
 * pendant un temps borné, la pièce reste en vente. Rien ici ne pose de verrou.
 */
export async function answerCounterOffer(input: {
  counterOfferId: string
  /** Le compte qui répond. La contre-proposition n'existe que pour un compte. */
  userId: string
  answer: CounterAnswer
  now?: Date
  policy?: OfferPolicy
}): Promise<AnswerCounterResult> {
  const now = input.now ?? new Date()
  const policy = input.policy ?? (await getOfferPolicy())

  return prisma.$transaction(async (tx) => {
    const counter = await tx.offer.findFirst({
      // La portée est ici, pas dans l'appelant : une lecture bornée au
      // propriétaire ne peut pas être élargie par erreur plus tard.
      where: { id: input.counterOfferId, userId: input.userId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        expiresAt: true,
        parentOfferId: true,
        article: { select: { status: true, floorPriceCents: true } },
      },
    })

    if (!counter) return { ok: false as const, reason: 'not-found' as const }

    // Une offre qu'elle a déposée elle-même n'est pas une contre-proposition :
    // l'accepter serait s'auto-accorder un prix.
    if (counter.parentOfferId === null) {
      return { ok: false as const, reason: 'not-a-counter' as const }
    }

    if (counter.status !== 'PENDING') {
      return { ok: false as const, reason: 'not-pending' as const }
    }

    // Le balayage ne passe que par intermittence : c'est l'échéance qui fait
    // foi, pas le statut.
    if (counter.expiresAt <= now) {
      return { ok: false as const, reason: 'expired' as const }
    }

    if (counter.article.status === 'SOLD') {
      return { ok: false as const, reason: 'article-unavailable' as const }
    }

    const accepted = input.answer === 'accept'

    const priceValidUntil = accepted
      ? new Date(
          now.getTime() + policy.acceptedOfferValidityHours * 60 * 60 * 1000,
        )
      : null

    // La trace de la vente à perte est posée ICI, à l'acceptation : c'est
    // l'instant où le prix devient réellement dû. Le vendeur l'a déjà déclarée
    // en émettant la contre-proposition ; sans cette seconde écriture, la
    // colonne resterait fausse sur la ligne qui porte le prix payé.
    const belowFloor =
      accepted && isBelowFloor(counter.amountCents, counter.article.floorPriceCents)

    const moved = await tx.$executeRaw`
      UPDATE "Offer"
      SET "status" = ${accepted ? 'ACCEPTED' : 'REJECTED'}::"OfferStatus",
          "respondedAt" = ${now},
          "priceValidUntil" = ${priceValidUntil},
          "acceptedBelowFloor" = ${belowFloor},
          "rejectionReason" = ${accepted ? null : 'MANUAL'},
          "updatedAt" = now()
      WHERE "id" = ${counter.id}
        AND "userId" = ${input.userId}
        AND "status" = 'PENDING'
    `

    // Zéro ligne : le balayage, ou un second onglet, a fait la transition entre
    // la lecture et l'écriture.
    if (moved === 0) {
      return { ok: false as const, reason: 'not-pending' as const }
    }

    return { ok: true as const, accepted, priceValidUntil }
  })
}

// ---------------------------------------------------------------------------
// Le temps qui passe
// ---------------------------------------------------------------------------

/**
 * Fait expirer les offres restées sans réponse.
 *
 * Idempotent par construction : la condition porte sur l'échéance, donc une
 * seconde exécution ne trouve plus rien. Renvoie le nombre d'offres éteintes.
 */
export async function expireStaleOffers(now = new Date()): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Offer"
    SET "status" = 'EXPIRED',
        "respondedAt" = ${now},
        "updatedAt" = now()
    WHERE "status" = 'PENDING'
      AND "expiresAt" <= ${now}
  `
}

/**
 * Solde les négociations d'une commande qui vient d'être payée.
 *
 * ---------------------------------------------------------------------------
 * Deux sorts, et les confondre serait une faute
 * ---------------------------------------------------------------------------
 * L'offre qui a SERVI à cette vente est `CONSUMED` : elle a produit son effet,
 * elle justifie un montant porté sur une facture, et elle ne doit plus pouvoir
 * en produire un second.
 *
 * Les autres — celles de personnes qui négociaient la même pièce — sont
 * `VOIDED`. Elles ont perdu leur objet, elles n'ont pas été jugées.
 *
 * Le défaut que cela corrige : `voidOffersForArticles` éteignait indistinc-
 * tement tout ce qui était `PENDING` ou `ACCEPTED` sur la pièce vendue, y
 * compris l'offre acceptée qui venait de servir à fixer le prix payé. Une
 * facture aurait alors porté un montant justifié par une offre marquée « sans
 * objet ».
 *
 * L'ordre compte : on consomme d'abord, on annule ensuite. À l'inverse,
 * l'annulation emporterait l'offre utilisée avant qu'on ait pu la consommer.
 */
export async function settleOffersForOrder(
  tx: Prisma.TransactionClient,
  input: { orderId: string; articleIds: readonly string[] },
  now = new Date(),
): Promise<{ consumed: number; voided: number }> {
  const used = await tx.orderItem.findMany({
    where: { orderId: input.orderId, offerId: { not: null } },
    select: { offerId: true },
  })

  const usedIds = used.flatMap((item) => (item.offerId ? [item.offerId] : []))

  const consumed =
    usedIds.length === 0
      ? 0
      : await tx.$executeRaw`
          UPDATE "Offer"
          SET "status" = 'CONSUMED',
              "updatedAt" = now()
          WHERE "id" = ANY(${usedIds}::text[])
            AND "status" = 'ACCEPTED'
        `

  const voided = await voidOffersForArticles(tx, input.articleIds, now)

  return { consumed, voided }
}

/**
 * Éteint les offres d'une pièce qui vient de partir.
 *
 * À appeler DANS la transaction de vente. Laisser une offre en attente sur une
 * pièce vendue produirait, quelques heures plus tard, une acceptation sans
 * objet — et une cliente à qui l'on aurait promis un prix sur un vêtement qui
 * n'existe plus.
 *
 * `VOIDED` et non `REJECTED` : la proposition n'a pas été jugée, elle a perdu
 * son objet. Les confondre ferait compter une malchance comme un refus, donc
 * ouvrirait un délai de carence à quelqu'un qui n'a rien fait de mal.
 */
export type OfferVoidReason = 'ARTICLE_SOLD' | 'ARTICLE_WITHDRAWN'

export async function voidOffersForArticles(
  tx: Prisma.TransactionClient,
  articleIds: readonly string[],
  now = new Date(),
  reason: OfferVoidReason = 'ARTICLE_SOLD',
): Promise<number> {
  const ids = [...new Set(articleIds)]
  if (ids.length === 0) return 0

  // Le motif est un PARAMÈTRE LIÉ, jamais interpolé dans la chaîne SQL. Il
  // vient aujourd'hui d'une union fermée de deux valeurs, donc rien ne
  // pourrait s'y glisser — mais une union fermée se desserre au premier besoin
  // nouveau, et c'est le jour où l'interpolation cesserait d'être inoffensive.
  return tx.$executeRaw`
    UPDATE "Offer"
    SET "status" = 'VOIDED',
        "respondedAt" = ${now},
        "rejectionReason" = ${reason},
        "updatedAt" = now()
    WHERE "articleId" = ANY(${ids}::text[])
      AND "status" IN ('PENDING', 'ACCEPTED')
  `
}
