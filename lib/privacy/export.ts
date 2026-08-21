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

  const [addresses, orders, favorites, offers, sizeAlerts, reviews] =
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
        where: { userId },
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
      prisma.favorite.findMany({
        where: { userId },
        select: { articleId: true, createdAt: true },
      }),
      prisma.offer.findMany({
        where: { userId },
        select: {
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
    favorites,
    offers,
    sizeAlerts,
    reviews,
  }
}
