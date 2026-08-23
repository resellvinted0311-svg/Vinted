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
      tx.offer.findFirst({
        where: {
          articleId: article.id,
          status: 'REJECTED',
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
      guestEmail: true,
      user: { select: { email: true, locale: true } },
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

  const outcome =
    offer.status === 'ACCEPTED'
      ? ('accepted' as const)
      : offer.status === 'PENDING'
        ? ('pending' as const)
        : ('rejected' as const)

  return {
    locale: language,
    email,
    reference: offer.article.sku,
    title,
    amountCents: offer.amountCents,
    outcome,
    expiresAt: offer.expiresAt,
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
  | { action: 'counter'; counterAmountCents: number }

export type RespondResult =
  | { ok: false; reason: 'not-found' | 'not-pending' | 'article-unavailable' | 'invalid-counter' }
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
      // Une contre-offre au-dessus du prix affiché n'en est pas une, et une
      // contre-offre sous l'offre reçue reviendrait à négocier contre soi.
      if (amount <= offer.amountCents || amount >= offer.article.priceCents) {
        return { ok: false as const, reason: 'invalid-counter' as const }
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
export async function voidOffersForArticles(
  tx: Prisma.TransactionClient,
  articleIds: readonly string[],
  now = new Date(),
): Promise<number> {
  const ids = [...new Set(articleIds)]
  if (ids.length === 0) return 0

  return tx.$executeRaw`
    UPDATE "Offer"
    SET "status" = 'VOIDED',
        "respondedAt" = ${now},
        "rejectionReason" = 'ARTICLE_SOLD',
        "updatedAt" = now()
    WHERE "articleId" = ANY(${ids}::text[])
      AND "status" IN ('PENDING', 'ACCEPTED')
  `
}
