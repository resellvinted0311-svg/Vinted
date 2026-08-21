import 'server-only'

import { prisma } from '@/lib/db/client'
import type {
  ShippingZoneGrid,
  ShippingRateGrid,
} from '@/lib/domain/shipping'

/**
 * Grilles d'expédition, lues en base et rendues au domaine.
 *
 * Le domaine (`lib/domain/shipping.ts`) est pur : il reçoit des zones et des
 * tarifs, il ne sait pas d'où ils viennent. Ce module est le seul point de
 * traduction entre les colonnes Prisma et ces formes-là.
 *
 * Les deux listes sont lues ENSEMBLE, en une transaction de lecture. Deux
 * requêtes séparées peuvent tomber de part et d'autre d'une modification en
 * back-office — une zone déjà supprimée dont les tarifs sont encore là, ou
 * l'inverse — et produire un devis calculé sur une grille qui n'a jamais
 * existé.
 */
export interface ShippingGrids {
  zones: ShippingZoneGrid[]
  rates: ShippingRateGrid[]
}

export async function getShippingGrids(): Promise<ShippingGrids> {
  const [zoneRows, rateRows] = await prisma.$transaction([
    prisma.shippingZone.findMany({
      orderBy: { position: 'asc' },
      select: {
        code: true,
        name: true,
        countries: true,
        postalPrefixes: true,
        freeShippingThresholdCents: true,
        requiresCustoms: true,
        position: true,
      },
    }),
    prisma.shippingRate.findMany({
      // Un tarif désactivé n'est plus proposé. Il reste en base parce que des
      // commandes passées y font référence par leur instantané.
      where: { active: true },
      orderBy: { maxWeightGrams: 'asc' },
      select: {
        carrierCode: true,
        serviceCode: true,
        label: true,
        maxWeightGrams: true,
        priceCents: true,
        deliveryDaysMin: true,
        deliveryDaysMax: true,
        requiresServicePoint: true,
        zone: { select: { code: true } },
      },
    }),
  ])

  return {
    zones: zoneRows,
    rates: rateRows.map((rate) => ({
      zoneCode: rate.zone.code,
      carrierCode: rate.carrierCode,
      serviceCode: rate.serviceCode,
      label: rate.label,
      maxWeightGrams: rate.maxWeightGrams,
      priceCents: rate.priceCents,
      deliveryDaysMin: rate.deliveryDaysMin,
      deliveryDaysMax: rate.deliveryDaysMax,
      requiresServicePoint: rate.requiresServicePoint,
    })),
  }
}
