import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { SITE } from '@/lib/config/site'
import { areTermsPublished } from '@/lib/config/pages'
import { getSettings } from '@/lib/config/settings'
import { getShippingGrids } from '@/lib/db/queries/shipping'
import {
  quoteShipping,
  findQuotedOption,
  type ShippingFailure,
  type ShippingOption,
} from '@/lib/domain/shipping'
import {
  computeOrderAmounts,
  assertLinesMatchTotal,
} from '@/lib/domain/order-total'
import {
  acquireStockLocks,
  releaseStockLocks,
  serializeOwner,
} from '@/lib/shop/stock-lock'
import { ensureCartOwner, findCart, type CartOwner } from '@/lib/shop/cart'
import { enqueueSyncEvents } from '@/lib/sync/outbound'
import { payablePriceCents } from '@/lib/domain/offers'
import { readNegotiatedPrices } from '@/lib/shop/negotiated-price'
import { evaluateCartLine, isPurchasable } from '@/lib/domain/cart'
import { isStripeConfigured, stripe } from '@/lib/payments/stripe'
import type { StartCheckoutInput } from '@/lib/validation/checkout'

/**
 * Ouverture d'un paiement.
 *
 * ---------------------------------------------------------------------------
 * L'ordre des opérations est la sécurité
 * ---------------------------------------------------------------------------
 *  1. Le panier est relu EN BASE. Aucun identifiant d'article, aucun prix,
 *     aucun montant ne vient du réseau — seulement une adresse, une adresse
 *     e-mail et le CHOIX d'un mode de livraison.
 *  2. Le devis de port est recalculé à partir des grilles en base, du poids
 *     réel et du sous-total réel.
 *  3. Le stock est verrouillé — tout ou rien — DANS la même transaction que la
 *     création de la commande. Deux personnes ne peuvent pas payer la même
 *     pièce.
 *  4. La session de paiement est créée APRÈS le commit, jamais pendant : un
 *     appel réseau à l'intérieur d'une transaction tient des verrous ouverts
 *     pendant que l'on attend un tiers.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module ne fait pas
 * ---------------------------------------------------------------------------
 * Il ne marque RIEN comme payé. Le brief l'interdit explicitement, et pour une
 * bonne raison : la page de retour est une simple redirection du navigateur,
 * que n'importe qui peut ouvrir à la main. Seul le webhook signé fait foi.
 */

export type CheckoutFailure =
  | { reason: 'payment-not-configured' }
  | { reason: 'empty-cart' }
  /** Des lignes ne sont plus payables. On ne les retire jamais en silence. */
  | { reason: 'blocked-lines'; articleIds: string[] }
  | { reason: 'shipping-unavailable'; failure: ShippingFailure }
  | { reason: 'unknown-shipping-option' }
  | { reason: 'service-point-required' }
  /** Une pièce vient d'être prise par quelqu'un d'autre. */
  | { reason: 'stock-taken'; articleIds: string[] }

export type CheckoutResult =
  | {
      ok: true
      orderId: string
      orderNumber: string
      totalCents: number
      /** Secret de la session de paiement, à remettre à Stripe.js. */
      clientSecret: string
    }
  | { ok: false; failure: CheckoutFailure }

/**
 * Durée minimale d'une session de paiement Stripe, en minutes.
 *
 * Imposée par Stripe, pas choisie par nous : `expires_at` ne peut pas être
 * fixé à moins de trente minutes.
 *
 * C'est ce chiffre qui gouverne la durée du verrou de stock, et non l'inverse.
 * Un verrou plus court que la session ouvrirait une fenêtre où la pièce est
 * libre alors que quelqu'un est encore devant son formulaire de carte : il
 * paierait un exemplaire déjà vendu à un autre. Le réglage
 * `reservationTtlMinutes` est donc un PLANCHER que l'on relève au besoin,
 * jamais un plafond que l'on force.
 *
 * Le prix de cette correction : un paiement abandonné immobilise la pièce une
 * demi-heure au lieu d'un quart d'heure. C'est le bon échange — une pièce
 * indisponible trente minutes se retrouve, une pièce vendue deux fois se
 * rembourse et s'excuse.
 */
const STRIPE_MIN_SESSION_MINUTES = 30

/** Lignes du panier, relues avec ce qu'il faut pour décider et facturer. */
type CheckoutLine = {
  articleId: string
  /**
   * Ce qui sera FACTURÉ : le prix affiché, ou le prix négocié quand une offre
   * acceptée est encore valable.
   *
   * Recalculé ici, dans la transaction, à partir de la base. Le navigateur n'a
   * envoyé aucun montant — le brief l'interdit — et la page du panier a beau
   * afficher le même chiffre, c'est celui-ci qui part au paiement.
   */
  priceCents: number
  /**
   * L'offre qui justifie ce prix, ou `null`.
   *
   * Figée sur `OrderItem` : contrairement au panier, où elle est résolue à
   * chaque lecture, elle ne doit plus bouger une fois la commande passée. Elle
   * explique un montant porté sur une facture.
   */
  offerId: string | null
  costCents: number
  weightGrams: number
  title: string
  imageUrl: string
}

/**
 * Numéro de commande, tiré d'une séquence PostgreSQL.
 *
 * Un `COUNT(*) + 1` ferait lire le même nombre à deux commandes simultanées :
 * l'une des deux échouerait sur la contrainte d'unicité, au pire moment.
 */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<[{ value: bigint }]>`
    SELECT nextval('order_number_seq') AS "value"
  `
  const year = new Date().getUTCFullYear()
  return `CMD-${year}-${String(row?.value ?? 0n).padStart(6, '0')}`
}

/** Relit le panier dans la transaction, qualifié à l'horloge de la base. */
async function readCheckoutLines(
  tx: Prisma.TransactionClient,
  owner: CartOwner,
  cartId: string,
  locale: string,
): Promise<{ lines: CheckoutLine[]; blockedArticleIds: string[] }> {
  const items = await tx.cartItem.findMany({
    where: { cartId },
    orderBy: { addedAt: 'asc' },
    select: {
      articleId: true,
      unitPriceCents: true,
      article: {
        select: {
          sku: true,
          priceCents: true,
          costCents: true,
          weightGrams: true,
          status: true,
          publishedAt: true,
          reservedById: true,
          reservedUntil: true,
          images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
          translations: { select: { locale: true, title: true } },
        },
      },
    },
  })

  const [{ now }] = await tx.$queryRaw<[{ now: Date }]>`SELECT now() AS "now"`

  // Les prix négociés, relus DANS la transaction. Le panier les a déjà
  // affichés, mais un affichage n'engage rien : une offre peut avoir expiré
  // entre la page et le clic, et c'est ce calcul-ci qui facture.
  const negotiatedByArticle = await readNegotiatedPrices(
    tx,
    owner,
    items.map((item) => item.articleId),
    now,
  )

  const lines: CheckoutLine[] = []
  const blockedArticleIds: string[] = []

  for (const item of items) {
    const article = item.article

    const state = evaluateCartLine({
      status: article.status,
      publishedAt: article.publishedAt,
      reservedById: article.reservedById,
      reservedUntil: article.reservedUntil,
      currentPriceCents: article.priceCents,
      snapshotUnitPriceCents: item.unitPriceCents,
      viewerLockOwnerId: owner.lockOwnerId,
      now,
    })

    // Un écart de prix n'empêche pas de payer : c'est le prix COURANT qui est
    // facturé, et la page du panier l'a déjà signalé. Ce qui bloque, c'est ce
    // qui n'est plus achetable du tout — on réutilise le prédicat du domaine
    // plutôt que de réénumérer les états ici, où l'oubli d'un cas se traduirait
    // par une vente impossible à honorer.
    if (!isPurchasable(state)) {
      blockedArticleIds.push(item.articleId)
      continue
    }

    const translation =
      article.translations.find((entry) => entry.locale === locale) ??
      article.translations.find((entry) => entry.locale === 'fr') ??
      article.translations[0]

    const negotiated = negotiatedByArticle.get(item.articleId) ?? null

    lines.push({
      articleId: item.articleId,
      priceCents: payablePriceCents(
        article.priceCents,
        negotiated
          ? {
              status: 'ACCEPTED',
              amountCents: negotiated.amountCents,
              priceValidUntil: negotiated.priceValidUntil,
            }
          : null,
        now,
      ),
      offerId: negotiated?.offerId ?? null,
      costCents: article.costCents,
      weightGrams: article.weightGrams,
      title: translation?.title ?? article.sku,
      // Colonne non nulle au schéma ; une pièce sans photo garde une chaîne
      // vide plutôt qu'une URL inventée.
      imageUrl: article.images[0]?.url ?? '',
    })
  }

  return { lines, blockedArticleIds }
}

/**
 * Prépare le paiement : commande créée, stock verrouillé, session ouverte.
 *
 * `input` a DÉJÀ traversé `startCheckoutSchema`. Ce module ne revalide pas les
 * formes, il recalcule les montants — ce sont deux choses différentes.
 *
 * Cette fonction ne fait que RÉSOUDRE l'identité : elle lit la session et le
 * cookie, puis délègue. Tout le raisonnement vit dans `prepareCheckoutFor`,
 * qui reçoit le propriétaire au lieu de le deviner — c'est ce qui rend le
 * chemin de paiement testable sans contexte de requête, donc réellement testé.
 */
export async function prepareCheckout(
  input: StartCheckoutInput,
): Promise<CheckoutResult> {
  // Avant tout verrou et toute écriture : sans paiement configuré, ouvrir une
  // commande immobiliserait du stock pour rien.
  if (!isStripeConfigured()) {
    return { ok: false, failure: { reason: 'payment-not-configured' } }
  }

  const owner = await ensureCartOwner()
  const cart = await findCart(owner)
  if (!cart) return { ok: false, failure: { reason: 'empty-cart' } }

  return prepareCheckoutFor(owner, cart.id, input)
}

/**
 * Le noyau : propriétaire et panier connus, plus rien à deviner.
 *
 * `server-only`, donc aucune adresse réseau. Le propriétaire arrive en
 * paramètre parce qu'il a déjà été établi par l'appelant — le recevoir du
 * réseau serait la faille exacte corrigée sur `mergeGuestFavorites`.
 */
export async function prepareCheckoutFor(
  owner: CartOwner,
  cartId: string,
  input: StartCheckoutInput,
): Promise<CheckoutResult> {
  const prepared = await prisma.$transaction(async (tx) => {
    // Sérialise l'ENSEMBLE de la section critique pour ce propriétaire, pas
    // seulement la prise de verrou.
    //
    // Sans cela — vérifié en exécution — deux onglets du même acheteur
    // ouvraient deux commandes vivantes sur la même pièce : le verrou de stock
    // admet volontairement la reprise par le même propriétaire, donc la
    // seconde tentative reprenait son propre verrou au lieu d'être refusée.
    // Deux sessions de paiement, deux débits, un seul exemplaire.
    await serializeOwner(tx, owner.lockOwnerId)

    const { lines, blockedArticleIds } = await readCheckoutLines(
      tx,
      owner,
      cartId,
      input.locale,
    )

    if (blockedArticleIds.length > 0) {
      return {
        ok: false as const,
        failure: { reason: 'blocked-lines' as const, articleIds: blockedArticleIds },
      }
    }
    if (lines.length === 0) {
      return { ok: false as const, failure: { reason: 'empty-cart' as const } }
    }

    // Réglages et grilles lus DANS la transaction : deux lectures séparées
    // peuvent tomber de part et d'autre d'une modification en back-office et
    // produire un devis calculé sur une grille qui n'a jamais existé.
    // `tx` et non le client global : lues avec le client global depuis
    // l'intérieur d'une transaction, ces requêtes demanderaient une SECONDE
    // connexion au pool. Il n'y en a qu'une en production
    // (`connection_limit=1`) et la transaction la tient — interblocage
    // jusqu'au délai d'attente, invisible en développement où la limite n'est
    // pas posée. Séquentiel et non `Promise.all` : une transaction interactive
    // n'a qu'une connexion, les paralléliser ne gagne rien et brouille l'ordre.
    const settings = await getSettings(
      [
        'packagingWeightGrams',
        'shippingMarkupPercent',
        'reservationTtlMinutes',
        'cgvVersion',
      ],
      tx,
    )
    const grids = await getShippingGrids(tx)

    const amountsBeforeShipping = computeOrderAmounts({
      itemPricesCents: lines.map((line) => line.priceCents),
      shippingCents: 0,
    })

    const quote = quoteShipping(
      {
        destination: {
          countryCode: input.shippingAddress.country,
          postalCode: input.shippingAddress.postalCode,
        },
        articleWeightsGrams: lines.map((line) => line.weightGrams),
        subtotalCents: amountsBeforeShipping.subtotalCents,
      },
      grids.zones,
      grids.rates,
      settings,
    )

    if (!quote.ok) {
      return {
        ok: false as const,
        failure: { reason: 'shipping-unavailable' as const, failure: quote.failure },
      }
    }

    const option = findQuotedOption(quote.quote, input.shipping)
    if (!option) {
      return {
        ok: false as const,
        failure: { reason: 'unknown-shipping-option' as const },
      }
    }
    if (option.requiresServicePoint && !input.shipping.servicePointId) {
      return {
        ok: false as const,
        failure: { reason: 'service-point-required' as const },
      }
    }

    const amounts = computeOrderAmounts({
      itemPricesCents: lines.map((line) => line.priceCents),
      shippingCents: option.chargedCents,
    })

    // Le verrou est pris ICI, dans la même transaction que la commande. Le
    // prendre avant laisserait une fenêtre où le stock est immobilisé sans
    // commande en face ; après, deux personnes pourraient payer la même pièce.
    const locked = await acquireStockLocks(tx, {
      articleIds: lines.map((line) => line.articleId),
      ownerId: owner.lockOwnerId,
      // Jamais moins que la durée de vie de la session de paiement : voir
      // STRIPE_MIN_SESSION_MINUTES.
      ttlMinutes: Math.max(
        settings.reservationTtlMinutes,
        STRIPE_MIN_SESSION_MINUTES,
      ),
    })

    if (!locked.ok) {
      return {
        ok: false as const,
        failure: {
          reason: 'stock-taken' as const,
          articleIds: locked.unavailableArticleIds,
        },
      }
    }

    // La réservation remonte à l'application de gestion : une pièce en cours de
    // paiement ici ne doit pas être vendue en parallèle sur une autre place de
    // marché. C'est tout l'intérêt de l'annoncer AVANT la vente plutôt qu'après.
    //
    // Le verrou est le fait, pas la commande : si la transaction échoue plus
    // bas, ni le verrou ni la remontée n'existent.
    await enqueueSyncEvents(tx, {
      event: 'article.reserved',
      articleIds: lines.map((line) => line.articleId),
      occurredAt: new Date(),
    })

    // Toute commande encore en attente de paiement, du même propriétaire, sur
    // l'une de ces pièces, est écartée : elle ne doit pas rester payable en
    // parallèle de celle qu'on ouvre. Sa session Stripe est fermée juste après
    // le commit — c'est un appel réseau, il n'a rien à faire ici.
    const superseded = await tx.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        lockOwnerId: owner.lockOwnerId,
        items: { some: { articleId: { in: lines.map((line) => line.articleId) } } },
      },
      select: { id: true, stripeSessionId: true },
    })

    if (superseded.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: superseded.map((order) => order.id) } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      })
    }

    const orderNumber = await nextOrderNumber(tx)
    const billing = input.billingAddress ?? input.shippingAddress

    const order = await tx.order.create({
      data: {
        orderNumber,
        userId: owner.userId,
        // Qui détient le verrou de stock de cette commande. Sans cette
        // information, la libérer plus tard reviendrait à rendre à la vente
        // toute pièce réservée du lot, y compris celle qu'un autre acheteur
        // vient de réserver pour son propre paiement.
        lockOwnerId: owner.lockOwnerId,
        email: input.email,
        locale: input.locale,
        status: 'PENDING_PAYMENT',

        subtotalCents: amounts.subtotalCents,
        discountCents: amounts.discountCents,
        shippingCents: amounts.shippingCents,
        totalCents: amounts.totalCents,
        // Coût transporteur réel : privé, il ne sort d'aucune réponse publique.
        shippingCostCents: option.carrierCostCents,

        shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
        billingAddress: billing as unknown as Prisma.InputJsonValue,

        shippingCarrierCode: option.carrierCode,
        shippingServiceCode: option.serviceCode,
        servicePointId: input.shipping.servicePointId ?? null,

        customerNote: input.customerNote ?? null,

        // Preuve d'acceptation, horodatée et versionnée — MAIS SEULEMENT si
        // les conditions générales existent réellement.
        //
        // Le commentaire précédent affirmait que « la case reste inactive tant
        // que les CGV ne sont pas rédigées ». C'était faux : la case est
        // active, le schéma exige `acceptsTerms: true`, et ces deux lignes
        // écrivaient `cgvVersion: '2026-01'` avec un horodatage alors que la
        // page correspondante affiche « Contenu rédigé en Phase 7 ».
        //
        // On constituait donc la preuve écrite qu'une personne avait accepté
        // un document inexistant. Ce n'est pas une preuve incomplète, c'est
        // une preuve fausse : produite dans un litige, elle se retourne contre
        // celui qui l'invoque. Mieux vaut n'en avoir aucune.
        ...(areTermsPublished()
          ? { cgvVersion: settings.cgvVersion, cgvAcceptedAt: new Date() }
          : {}),

        items: {
          create: lines.map((line) => ({
            articleId: line.articleId,
            titleSnapshot: line.title,
            imageSnapshot: line.imageUrl,
            unitPriceCents: line.priceCents,
            // L'offre qui justifie le prix, quand il a été négocié. Sans elle,
            // une ligne de facture à 30 € sur une pièce affichée 38 € serait
            // inexplicable six mois plus tard.
            offerId: line.offerId,
            // Instantané du coût d'achat : sert au calcul de marge a
            // posteriori, ne sort jamais côté client.
            costCentsSnapshot: line.costCents,
          })),
        },
      },
      select: { id: true, orderNumber: true },
    })

    return {
      ok: true as const,
      order,
      lines,
      amounts,
      option,
      lockedUntil: locked.until,
      supersededSessionIds: superseded
        .map((order) => order.stripeSessionId)
        .filter((id): id is string => Boolean(id)),
    }
  })

  if (!prepared.ok) return { ok: false, failure: prepared.failure }

  const { order, lines, amounts, option, lockedUntil, supersededSessionIds } =
    prepared

  // Fermeture des sessions écartées, hors transaction. Sans cela, l'ancienne
  // resterait payable : l'acheteur qui reviendrait sur l'onglet précédent
  // serait débité une seconde fois pour la même pièce.
  await expireSupersededSessions(supersededSessionIds)

  // ---------------------------------------------------------------------
  // Session de paiement — hors transaction
  // ---------------------------------------------------------------------
  // Tout ce qui suit est DANS le `try`, y compris la construction des lignes
  // et le contrôle de somme.
  //
  // À ce point, la commande existe et le stock est verrouillé pour au moins
  // trente minutes. Le `catch` défait les deux. Laisser une seule instruction
  // faillible au-dehors — c'était le cas du contrôle de somme — revenait à
  // immobiliser une pièce unique jusqu'à l'expiration du verrou, sur une
  // erreur qui signale justement qu'il ne faut pas encaisser.
  try {
    const lineItems = buildLineItems(lines, option, input.locale)

    // Dernier filet avant le débit : la somme réellement transmise doit être
    // égale au centime au total enregistré. Un écart ne produirait aucune
    // erreur visible — Stripe débiterait SA somme, notre base garderait la
    // nôtre — et se découvrirait à la comptabilité, des semaines plus tard.
    assertLinesMatchTotal(
      lineItems.map((item) => item.price_data.unit_amount),
      amounts.totalCents,
    )

    const session = await stripe().checkout.sessions.create({
      // Paiement intégré : la personne reste sur la boutique. La saisie de
      // carte se fait dans un cadre servi par Stripe — aucun numéro de carte
      // ne traverse jamais ce serveur.
      ui_mode: 'embedded',
      mode: 'payment',
      // Carte uniquement : les moyens différés encaissent des jours plus tard,
      // ce qui immobiliserait une pièce unique sans certitude de vente.
      payment_method_types: ['card'],
      currency: SITE.currency.toLowerCase(),
      customer_email: input.email,
      line_items: lineItems,
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      // Repris aussi sur l'intention : le webhook peut recevoir l'un ou
      // l'autre selon l'événement, et doit retrouver la commande dans les deux
      // cas sans deviner.
      payment_intent_data: {
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      },
      // La session meurt EN MÊME TEMPS que le verrou, à la seconde près. Lui
      // laisser survivre au verrou reviendrait à laisser payer une pièce
      // redevenue disponible entre-temps.
      expires_at: Math.floor(lockedUntil.getTime() / 1000),
      return_url: `${SITE.url}/${input.locale}/commande/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    })

    if (!session.client_secret) {
      throw new Error('Session de paiement créée sans secret client.')
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id },
    })

    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents: amounts.totalCents,
      clientSecret: session.client_secret,
    }
  } catch (error) {
    // La commande existe et le stock est verrouillé, mais aucun paiement ne
    // pourra jamais s'y rattacher. On défait proprement plutôt que de laisser
    // une pièce immobilisée jusqu'à l'expiration du verrou.
    await releaseCheckout(order.id, owner.lockOwnerId, lines.map((l) => l.articleId))
    throw error
  }
}

/**
 * Ferme chez Stripe les sessions des commandes écartées.
 *
 * Au mieux : une session déjà expirée ou déjà payée fait lever l'appel, et ce
 * n'est pas une raison d'empêcher la nouvelle commande de s'ouvrir. L'échec
 * est journalisé, pas propagé — la commande écartée est de toute façon annulée
 * en base, donc un paiement tardif dessus la rouvrirait au lieu de disparaître.
 */
async function expireSupersededSessions(
  sessionIds: readonly string[],
): Promise<void> {
  for (const sessionId of sessionIds) {
    try {
      await stripe().checkout.sessions.expire(sessionId)
    } catch (error) {
      console.error(
        `[checkout] Session ${sessionId} non fermée :`,
        error instanceof Error ? error.message : 'erreur inconnue',
      )
    }
  }
}

/** Annule une commande jamais payée et rend son stock. */
async function releaseCheckout(
  orderId: string,
  ownerId: string,
  articleIds: readonly string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await releaseStockLocks(tx, { articleIds, ownerId })
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
  })
}

/** Une ligne telle qu'elle part chez le prestataire de paiement. */
interface StripeLineItem {
  quantity: 1
  price_data: {
    currency: string
    unit_amount: number
    product_data: { name: string; images?: string[] }
  }
}

/**
 * Compose les lignes envoyées au paiement.
 *
 * Le port est une ligne comme les autres. Le passer par `shipping_options`
 * laisserait Stripe le recalculer selon SES règles ; ici, le montant est celui
 * de notre devis, et rien d'autre.
 */
function buildLineItems(
  lines: readonly CheckoutLine[],
  option: ShippingOption,
  locale: string,
): StripeLineItem[] {
  const currency = SITE.currency.toLowerCase()

  const items: StripeLineItem[] = lines.map((line) => ({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: line.priceCents,
      product_data: {
        name: line.title,
        // Stripe refuse une URL vide : on n'envoie le tableau que s'il y a
        // réellement une image, et seulement en absolu.
        ...(line.imageUrl.startsWith('http') ? { images: [line.imageUrl] } : {}),
      },
    },
  }))

  // Le port apparaît même à zéro : une franchise qui ne se voit pas passe pour
  // un oubli, et le récapitulatif de paiement doit dire la même chose que la
  // page du panier.
  items.push({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: option.chargedCents,
      product_data: { name: shippingLabel(option, locale) },
    },
  })

  return items
}

function shippingLabel(option: ShippingOption, locale: string): string {
  const offered = locale === 'fr' ? 'Livraison offerte' : 'Free shipping'
  return option.freeShippingApplied && option.chargedCents === 0
    ? offered
    : option.label
}
