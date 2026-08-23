import 'server-only'

import { prisma } from '@/lib/db/client'

/**
 * Droit d'accès et portabilité — articles 15 et 20 du RGPD.
 *
 * Un seul format sert les deux droits : du JSON, structuré, lisible par une
 * personne comme par un logiciel. L'article 20 exige « un format structuré,
 * couramment utilisé et lisible par machine » ; l'article 15 exige une copie
 * des données. Un même fichier satisfait les deux, à condition qu'il soit
 * complet.
 *
 * ---------------------------------------------------------------------------
 * Ce qui n'y figure pas, et pourquoi
 * ---------------------------------------------------------------------------
 * L'empreinte du mot de passe. Ce n'est pas une donnée que la personne a
 * fournie : c'est un dérivé cryptographique, et le remettre n'ajouterait rien
 * à sa connaissance tout en créant une cible. Même raisonnement pour les
 * jetons de session.
 *
 * En revanche, tout ce qui la décrit ou décrit ce qu'elle a fait y figure, y
 * compris ce qu'on préférerait ne pas montrer. Un export partiel n'est pas un
 * export.
 */

export interface PersonalDataExport {
  /** Horodatage de l'extraction, pour dater le document. */
  exportedAt: string
  account: Record<string, unknown>
  addresses: unknown[]
  orders: unknown[]
  /** Le panier en cours. Déclaré au registre, il doit donc être exporté. */
  cart: unknown[]
  favorites: unknown[]
  offers: unknown[]
  sizeAlerts: unknown[]
  reviews: unknown[]
}

export async function exportPersonalData(
  userId: string,
  now = new Date(),
): Promise<PersonalDataExport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      locale: true,
      role: true,
      emailVerified: true,
      marketingConsent: true,
      marketingConsentAt: true,
      lastSeenAt: true,
      createdAt: true,
      // Volontairement absents : passwordHash, sessions, jetons.
    },
  })

  if (!user) return null

  const [addresses, orders, cart, favorites, offers, sizeAlerts, reviews] =
    await Promise.all([
      prisma.address.findMany({
        where: { userId },
        select: {
          label: true,
          firstName: true,
          lastName: true,
          line1: true,
          line2: true,
          postalCode: true,
          city: true,
          country: true,
          phone: true,
          isDefault: true,
          createdAt: true,
        },
      }),
      prisma.order.findMany({
        // La portée ne peut pas être le seul `userId` : le paiement sans compte
        // est autorisé, et une commande d'invitée porte `userId: null`. Elle
        // n'était donc dans AUCUN export, alors qu'elle contient un nom, une
        // rue, un code postal, une ville, un téléphone et une note libre,
        // conservés dix ans.
        //
        // On élargit à l'adresse e-mail — mais UNIQUEMENT si elle a été
        // prouvée. Sans cette garde, il suffirait de créer un compte au nom de
        // quelqu'un pour lire ses commandes : exactement la faille que
        // `attachGuestOrders` évite déjà en exigeant aussi le jeton d'origine.
        //
        // À dire franchement : `emailVerified` n'est aujourd'hui posé que par
        // la connexion par lien magique. Pour un compte créé par mot de passe,
        // cette branche reste donc inerte tant que la vérification d'adresse
        // n'est pas branchée. Elle n'est pas décorative pour autant — elle
        // couvre déjà un chemin réel, et le jour où la vérification arrive,
        // elle couvre tout le monde sans qu'on ait à y repenser.
        where: user.emailVerified
          ? {
              OR: [
                { userId },
                {
                  userId: null,
                  email: { equals: user.email, mode: 'insensitive' },
                },
              ],
            }
          : { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          orderNumber: true,
          status: true,
          email: true,
          locale: true,
          subtotalCents: true,
          discountCents: true,
          shippingCents: true,
          totalCents: true,
          refundedCents: true,
          shippingAddress: true,
          billingAddress: true,
          shippingCarrierCode: true,
          customerNote: true,
          invoiceNumber: true,
          cgvVersion: true,
          cgvAcceptedAt: true,
          paidAt: true,
          shippedAt: true,
          deliveredAt: true,
          cancelledAt: true,
          createdAt: true,
          items: {
            select: {
              titleSnapshot: true,
              unitPriceCents: true,
            },
          },
          // `shippingCostCents` et le coût d'achat des lignes restent dehors :
          // ce sont des données de l'entreprise, pas de la personne.
        },
      }),
      // Le panier figure au registre des traitements : l'omettre de l'export
      // ferait mentir la déclaration, et l'article 15 demande une copie de
      // TOUT ce qui est détenu — y compris ce qui paraît sans intérêt.
      prisma.cartItem.findMany({
        where: { cart: { userId } },
        select: {
          articleId: true,
          unitPriceCents: true,
          priceSource: true,
          addedAt: true,
          article: { select: { sku: true } },
        },
        orderBy: { addedAt: 'desc' },
      }),
      prisma.favorite.findMany({
        where: { userId },
        select: { articleId: true, createdAt: true },
      }),
      prisma.offer.findMany({
        where: { userId },
        select: {
          // Sans la pièce visée, une offre n'est qu'un montant sans objet :
          // la personne ne peut pas relire ce qu'elle a proposé, ni sur quoi.
          articleId: true,
          article: { select: { sku: true } },
          amountCents: true,
          status: true,
          counterAmountCents: true,
          guestEmail: true,
          expiresAt: true,
          respondedAt: true,
          createdAt: true,
        },
      }),
      prisma.sizeAlert.findMany({
        where: { userId },
        select: {
          sizes: true,
          maxPriceCents: true,
          active: true,
          createdAt: true,
        },
      }),
      prisma.review.findMany({
        where: { userId },
        select: { rating: true, body: true, status: true, createdAt: true },
      }),
    ])

  return {
    exportedAt: now.toISOString(),
    account: user,
    addresses,
    orders,
    cart,
    favorites,
    offers,
    sizeAlerts,
    reviews,
  }
}
