import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import type { CartOwner } from '@/lib/shop/cart'

/**
 * Le prix négocié d'une pièce, quand il y en a un.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi c'est résolu À LA LECTURE, et non figé à l'ajout au panier
 * ---------------------------------------------------------------------------
 * `CartItem` porte une colonne `offerId`, et la tentation était de l'écrire au
 * moment de mettre la pièce au panier. Elle reste vide, délibérément.
 *
 * L'ordre des gestes ne se choisit pas : on met une pièce au panier, PUIS on
 * propose un prix, et la réponse arrive quelques heures plus tard. Figer
 * l'offre à l'ajout ferait payer le prix affiché à quelqu'un dont l'offre a
 * été acceptée entre-temps — c'est-à-dire exactement la personne à qui l'on
 * vient de promettre l'inverse par e-mail.
 *
 * Résoudre à la lecture donne toujours la bonne réponse, quel que soit l'ordre.
 * L'offre n'est FIGÉE qu'au moment de la commande, sur `OrderItem.offerId` :
 * là, elle justifie le prix porté sur une facture, et elle ne doit plus bouger.
 *
 * ---------------------------------------------------------------------------
 * Ce que « ne pas faire payer plus cher pour avoir négocié » veut dire
 * ---------------------------------------------------------------------------
 * Une baisse automatique peut amener le prix affiché SOUS le prix négocié.
 * C'est `payablePriceCents` (`lib/domain/offers.ts`) qui tranche, et il retient
 * le plus bas des deux. Ce module ne fait que fournir l'offre ; il ne calcule
 * aucun montant.
 */

export interface NegotiatedPrice {
  offerId: string
  amountCents: number
  priceValidUntil: Date
}

type Reader = Prisma.TransactionClient | typeof prisma

/**
 * Clause désignant les offres de CE panier.
 *
 * Avec un compte, l'identité est le compte. Sans compte, c'est le jeton de
 * session boutique — et non l'adresse e-mail, qu'on ne connaît pas au moment
 * d'afficher un panier. C'est la même identité que celle du panier lui-même :
 * un prix négocié suit le navigateur qui l'a négocié.
 */
function ownerClause(owner: CartOwner): Prisma.OfferWhereInput {
  return owner.userId
    ? { userId: owner.userId }
    : { userId: null, guestSessionToken: owner.sessionToken }
}

/**
 * Les offres ACCEPTÉES et encore valables, par pièce.
 *
 * Une seule requête pour tout le panier : une par ligne multiplierait les
 * allers-retours derrière un pooler réglé à une connexion.
 *
 * L'instant vient de l'appelant, pas de `new Date()` ici : le panier qualifie
 * toutes ses lignes à l'horloge de la BASE, et une échéance de prix évaluée
 * sur l'horloge de la fonction serverless pourrait tomber de l'autre côté.
 */
export async function readNegotiatedPrices(
  client: Reader,
  owner: CartOwner,
  articleIds: readonly string[],
  now: Date,
): Promise<Map<string, NegotiatedPrice>> {
  const ids = [...new Set(articleIds)]
  if (ids.length === 0) return new Map()

  const offers = await client.offer.findMany({
    where: {
      articleId: { in: ids },
      status: 'ACCEPTED',
      priceValidUntil: { gt: now },
      ...ownerClause(owner),
    },
    // La plus RÉCENTE d'abord : deux offres acceptées sur la même pièce ne
    // devraient pas exister, mais si cela arrive, c'est la dernière parole du
    // vendeur qui vaut.
    orderBy: { respondedAt: 'desc' },
    select: {
      id: true,
      articleId: true,
      amountCents: true,
      priceValidUntil: true,
    },
  })

  const byArticle = new Map<string, NegotiatedPrice>()
  for (const offer of offers) {
    if (byArticle.has(offer.articleId)) continue
    if (offer.priceValidUntil === null) continue

    byArticle.set(offer.articleId, {
      offerId: offer.id,
      amountCents: offer.amountCents,
      priceValidUntil: offer.priceValidUntil,
    })
  }

  return byArticle
}
