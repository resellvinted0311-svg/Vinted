import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { isArticleListed } from '@/lib/db/visibility'
import {
  articleIdSchema,
  articleIdListSchema,
  MAX_CART_LINES,
} from '@/lib/validation/shop'
import { getCurrentUser } from '@/lib/auth/session'
import {
  ensureShopSessionToken,
  readShopSessionToken,
} from '@/lib/shop/session-token'
import {
  evaluateCartLine,
  tallyCart,
  type CartLineState,
} from '@/lib/domain/cart'

/**
 * Panier — couche serveur.
 *
 * Calque exact du patron des favoris : lecture par `readShopSessionToken`,
 * écriture par `ensureShopSessionToken`. La distinction n'est pas cosmétique —
 * écrire un cookie pendant le rendu d'une page lève en Next 15, et le panier
 * est lu depuis des pages.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 *  1. AUCUN chemin de lecture n'écrit. `readCart` ne supprime pas une ligne
 *     devenue invalide, ne libère pas un verrou, ne touche pas à `updatedAt`.
 *     Le brief interdit de retirer une ligne en silence ; le faire depuis une
 *     lecture le rendrait en plus imprévisible.
 *
 *  2. Aucun montant ne vient du client. `unitPriceCents` est un instantané
 *     d'affichage servant UNIQUEMENT à détecter un écart — il n'entre dans
 *     aucun total.
 */

/** Propriétaire du panier et du verrou de stock. */
export interface CartOwner {
  userId: string | null
  sessionToken: string
  /**
   * Identifiant du propriétaire de verrou, écrit dans `Article.reservedById`.
   *
   * Le compte l'emporte sur le jeton : sans cela, se connecter en cours de
   * paiement changerait de propriétaire et l'on perdrait son propre verrou.
   */
  lockOwnerId: string
}

/** Propriétaire pour un chemin d'ÉCRITURE : crée le jeton s'il manque. */
export async function ensureCartOwner(): Promise<CartOwner> {
  const user = await getCurrentUser()
  const sessionToken = await ensureShopSessionToken()
  return {
    userId: user?.id ?? null,
    sessionToken,
    lockOwnerId: user?.id ?? sessionToken,
  }
}

/** Propriétaire pour un chemin de LECTURE : n'écrit jamais de cookie. */
export async function readCartOwner(): Promise<CartOwner | null> {
  const user = await getCurrentUser()
  const sessionToken = await readShopSessionToken()

  if (!user && !sessionToken) return null

  return {
    userId: user?.id ?? null,
    // Un compte sans cookie boutique est possible : la chaîne vide ne
    // correspondra à aucun panier de visiteur, ce qui est exactement voulu.
    sessionToken: sessionToken ?? '',
    lockOwnerId: user?.id ?? sessionToken ?? '',
  }
}

/**
 * Retrouve le panier existant, sans en créer.
 *
 * Le compte est cherché EN PREMIER : une personne connectée depuis un nouveau
 * navigateur doit retrouver son panier, pas en ouvrir un vide.
 */
export async function findCart(owner: CartOwner): Promise<{ id: string } | null> {
  if (owner.userId) {
    const byUser = await prisma.cart.findFirst({
      where: { userId: owner.userId },
      select: { id: true },
    })
    if (byUser) return byUser
  }

  if (owner.sessionToken === '') return null

  return prisma.cart.findUnique({
    where: { sessionToken: owner.sessionToken },
    select: { id: true },
  })
}

/** Retrouve le panier ou le crée. Réservé aux chemins d'écriture. */
async function ensureCart(owner: CartOwner): Promise<string> {
  const existing = await findCart(owner)
  if (existing) return existing.id

  try {
    const created = await prisma.cart.create({
      data: { userId: owner.userId, sessionToken: owner.sessionToken },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    // Deux requêtes simultanées du même visiteur — deux onglets qui ajoutent
    // en même temps — passent toutes deux la lecture puis se disputent
    // l'unicité. La perdante récupère le panier de la gagnante.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const raced = await findCart(owner)
      if (raced) return raced.id
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export interface CartLineView {
  cartItemId: string
  articleId: string
  slug: string
  sku: string
  title: string
  brandName: string | null
  imageUrl: string | null
  /** Prix courant — le seul qui fasse foi. */
  currentPriceCents: number
  weightGrams: number
  state: CartLineState
}

export interface CartView {
  lines: CartLineView[]
  totalCount: number
  purchasableCount: number
  blockedCount: number
  subtotalCents: number
}

const EMPTY_CART: CartView = {
  lines: [],
  totalCount: 0,
  purchasableCount: 0,
  blockedCount: 0,
  subtotalCents: 0,
}

/**
 * Contenu du panier, chaque ligne qualifiée.
 *
 * Aucune écriture. Une ligne devenue invalide est décrite, jamais retirée.
 */
export async function readCart(locale: string): Promise<CartView> {
  const owner = await readCartOwner()
  if (!owner) return EMPTY_CART

  const cart = await findCart(owner)
  if (!cart) return EMPTY_CART

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { addedAt: 'desc' },
    select: {
      id: true,
      articleId: true,
      unitPriceCents: true,
      article: {
        select: {
          slug: true,
          sku: true,
          priceCents: true,
          weightGrams: true,
          status: true,
          publishedAt: true,
          reservedById: true,
          reservedUntil: true,
          brand: { select: { name: true } },
          images: {
            select: { url: true },
            orderBy: { position: 'asc' },
            take: 1,
          },
          translations: {
            select: { locale: true, title: true },
          },
        },
      },
    },
  })

  // Un seul instant pour toutes les lignes : deux lignes évaluées à deux
  // instants différents pourraient se contredire au bord d'une expiration.
  //
  // Et cet instant vient de la BASE, pas de la fonction serverless. Les
  // échéances de verrou sont posées par PostgreSQL (`now() + make_interval`),
  // et `stock-lock.ts` explique longuement pourquoi les deux doivent vivre sur
  // la même horloge : une dérive de quelques secondes suffirait à afficher
  // « réservé » sur une pièce que le verrou considère déjà libre, ou
  // l'inverse.
  //
  // Sans conséquence aujourd'hui — cette lecture ne décide de rien, l'arbitre
  // reste `acquireStockLocks` — mais c'est précisément le genre d'écart qui ne
  // se voit qu'une fois qu'il a coûté une vente.
  const [{ now }] = await prisma.$queryRaw<[{ now: Date }]>`SELECT now() AS "now"`

  const lines: CartLineView[] = items.map((item) => {
    const article = item.article
    const translation =
      article.translations.find((entry) => entry.locale === locale) ??
      article.translations.find((entry) => entry.locale === 'fr') ??
      article.translations[0]

    return {
      cartItemId: item.id,
      articleId: item.articleId,
      slug: article.slug,
      sku: article.sku,
      title: translation?.title ?? article.sku,
      brandName: article.brand?.name ?? null,
      imageUrl: article.images[0]?.url ?? null,
      currentPriceCents: article.priceCents,
      weightGrams: article.weightGrams,
      state: evaluateCartLine({
        snapshotUnitPriceCents: item.unitPriceCents,
        currentPriceCents: article.priceCents,
        status: article.status,
        publishedAt: article.publishedAt,
        reservedById: article.reservedById,
        reservedUntil: article.reservedUntil,
        viewerLockOwnerId: owner.lockOwnerId,
        now,
      }),
    }
  })

  const tally = tallyCart(lines)

  return {
    lines,
    totalCount: tally.total,
    purchasableCount: tally.purchasable,
    blockedCount: tally.blocked,
    subtotalCents: tally.subtotalCents,
  }
}

/**
 * Décompte seul, pour le compteur d'en-tête.
 *
 * Volontairement séparé de `readCart` : l'en-tête n'a pas besoin des titres,
 * des images ni des traductions, et il est appelé sur chaque page.
 */
export async function readCartCount(): Promise<number> {
  const owner = await readCartOwner()
  if (!owner) return 0

  const cart = await findCart(owner)
  if (!cart) return 0

  return prisma.cartItem.count({ where: { cartId: cart.id } })
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export type CartMutationResult =
  | { ok: true; totalCount: number }
  | {
      ok: false
      reason:
        | 'unknown-article'
        | 'not-purchasable'
        | 'already-in-cart'
        | 'cart-full'
        /**
         * Trop d'écritures en peu de temps.
         *
         * Motif à part entière : le faire passer pour « pièce non achetable »
         * afficherait un message faux sur une pièce qui, elle, est disponible.
         * Posé par la couche réseau (`cart-actions.ts`), jamais ici.
         */
        | 'rate-limited'
    }

/**
 * Ajoute une pièce au panier.
 *
 * Le prix est lu EN BASE, jamais reçu du client. `unitPriceCents` mémorise ce
 * prix pour pouvoir signaler un écart plus tard — il ne sert à rien d'autre.
 *
 * Aucun verrou de stock n'est posé ici : réserver à l'ajout immobiliserait le
 * catalogue pour des paniers abandonnés. Le verrou est pris au paiement.
 */
export async function addToCart(articleId: string): Promise<CartMutationResult> {
  const parsed = articleIdSchema.safeParse(articleId)
  if (!parsed.success) return { ok: false, reason: 'unknown-article' }

  const article = await prisma.article.findFirst({
    where: { id: parsed.data },
    select: { id: true, priceCents: true, status: true, publishedAt: true },
  })

  if (!article) return { ok: false, reason: 'unknown-article' }

  // On refuse d'ajouter ce qui est déjà parti, retiré du registre, ou pas
  // encore en ligne. Une pièce RÉSERVÉE reste ajoutable : la réservation peut
  // expirer avant le paiement. C'est exactement la règle des grilles du
  // catalogue, donc le même prédicat.
  if (!isArticleListed(article)) {
    return { ok: false, reason: 'not-purchasable' }
  }

  const owner = await ensureCartOwner()
  const cartId = await ensureCart(owner)

  // Plafond de lignes. Le stock étant unitaire, un panier réel de seconde main
  // n'en compte jamais trente ; en revanche, rien n'empêchait d'en empiler des
  // milliers, chacune relue et réévaluée à chaque affichage du panier, et
  // chacune pesant sur le devis de port.
  const lineCount = await prisma.cartItem.count({ where: { cartId } })
  if (lineCount >= MAX_CART_LINES) {
    return { ok: false, reason: 'cart-full' }
  }

  try {
    await prisma.$transaction([
      prisma.cartItem.create({
        data: {
          cartId,
          articleId: article.id,
          unitPriceCents: article.priceCents,
          priceSource: 'LIST',
        },
      }),
      // Prisma n'applique `@updatedAt` qu'au modèle écrit : sans cette
      // écriture, `Cart.updatedAt` ne bougerait jamais et la purge des paniers
      // abandonnés supprimerait des paniers actifs.
      prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } }),
    ])
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { ok: false, reason: 'already-in-cart' }
    }
    throw error
  }

  return { ok: true, totalCount: await prisma.cartItem.count({ where: { cartId } }) }
}

/** Retire une pièce. Le seul chemin autorisé à supprimer une ligne. */
export async function removeFromCart(
  articleId: string,
): Promise<CartMutationResult> {
  const parsed = articleIdSchema.safeParse(articleId)
  if (!parsed.success) return { ok: false, reason: 'unknown-article' }

  const owner = await ensureCartOwner()
  const cart = await findCart(owner)
  if (!cart) return { ok: true, totalCount: 0 }

  await prisma.$transaction([
    prisma.cartItem.deleteMany({
      where: { cartId: cart.id, articleId: parsed.data },
    }),
    prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } }),
  ])

  return {
    ok: true,
    totalCount: await prisma.cartItem.count({ where: { cartId: cart.id } }),
  }
}

/**
 * Retire les lignes devenues impayables, sur demande explicite.
 *
 * Appelée par un bouton qui NOMME les pièces concernées. C'est la seule façon
 * de vider ce qui bloque sans violer l'interdiction de retirer en silence : la
 * décision reste celle de la cliente, prise en connaissance de cause.
 */
export async function removeBlockedLines(
  articleIds: readonly string[],
): Promise<CartMutationResult> {
  // Ce paramètre vient du réseau : chaque entrée devient un paramètre d'une
  // clause `IN`, et rien n'empêchait d'en envoyer cent mille. Les filtres
  // d'URL du catalogue sont bornés à 20 depuis le premier jour, avec la
  // raison écrite à côté ; il n'y avait aucun motif de traiter celui-ci
  // autrement.
  const parsed = articleIdListSchema.safeParse(articleIds)
  if (!parsed.success) return { ok: false, reason: 'unknown-article' }
  if (parsed.data.length === 0) return { ok: true, totalCount: 0 }

  const owner = await ensureCartOwner()
  const cart = await findCart(owner)
  if (!cart) return { ok: true, totalCount: 0 }

  await prisma.$transaction([
    prisma.cartItem.deleteMany({
      where: { cartId: cart.id, articleId: { in: parsed.data } },
    }),
    prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } }),
  ])

  return {
    ok: true,
    totalCount: await prisma.cartItem.count({ where: { cartId: cart.id } }),
  }
}

/**
 * Reprend le panier d'un visiteur dans son compte.
 *
 * Appelée à la connexion et à l'inscription, comme `mergeGuestFavorites`.
 *
 * Le verrou `FOR UPDATE` sur le panier invité n'est pas une précaution de
 * principe. Insérer une ligne prend un verrou `FOR KEY SHARE` sur le panier
 * parent — imposé par la clé étrangère — et `FOR UPDATE` entre en conflit avec
 * lui. Un ajout concurrent est donc mis en attente le temps de la fusion, au
 * lieu d'atterrir dans un panier qu'on s'apprête à supprimer : sans cela, la
 * ligne ajoutée pendant la fusion disparaissait avec le panier invité.
 */
export async function mergeGuestCart(userId: string): Promise<number> {
  const sessionToken = await readShopSessionToken()
  if (!sessionToken) return 0

  return prisma.$transaction(async (tx) => {
    const guest = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Cart"
      WHERE "sessionToken" = ${sessionToken} AND "userId" IS NULL
      FOR UPDATE
    `
    const guestCartId = guest[0]?.id
    if (!guestCartId) return 0

    const items = await tx.cartItem.findMany({
      where: { cartId: guestCartId },
      select: { articleId: true, unitPriceCents: true, priceSource: true, offerId: true },
    })

    if (items.length === 0) {
      await tx.cart.delete({ where: { id: guestCartId } })
      return 0
    }

    const target = await tx.cart.findFirst({
      where: { userId },
      select: { id: true },
    })

    // Sans panier de compte, le panier invité devient celui du compte : rien à
    // déplacer, donc aucune ligne ne peut se perdre en chemin.
    if (!target) {
      await tx.cart.update({
        where: { id: guestCartId },
        data: { userId, updatedAt: new Date() },
      })
      return items.length
    }

    // `skipDuplicates` couvre le cas courant : la même pièce des deux côtés.
    // La ligne du compte l'emporte — elle est plus ancienne, et sur un stock
    // unitaire les deux désignent le même exemplaire.
    const moved = await tx.cartItem.createMany({
      data: items.map((item) => ({
        cartId: target.id,
        articleId: item.articleId,
        unitPriceCents: item.unitPriceCents,
        priceSource: item.priceSource,
        offerId: item.offerId,
      })),
      skipDuplicates: true,
    })

    await tx.cart.update({
      where: { id: target.id },
      data: { updatedAt: new Date() },
    })
    await tx.cart.delete({ where: { id: guestCartId } })

    return moved.count
  })
}
