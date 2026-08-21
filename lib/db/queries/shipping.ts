import 'server-only'

import type { Prisma } from '@prisma/client'
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
 * Les deux listes sont lues ENSEMBLE, sous une même isolation. Deux lectures
 * séparées peuvent tomber de part et d'autre d'une modification en back-office
 * — une zone déjà supprimée dont les tarifs sont encore là, ou l'inverse — et
 * produire un devis calculé sur une grille qui n'a jamais existé.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `client` est un paramètre
 * ---------------------------------------------------------------------------
 * Appelée depuis l'intérieur d'une transaction interactive avec le client
 * GLOBAL, cette fonction demanderait une seconde connexion au pool. Or la
 * connexion applicative est réglée à UNE seule en production
 * (`connection_limit=1`, recommandation de Prisma derrière un pooler) : la
 * transaction tient l'unique connexion, la lecture attend celle qui ne se
 * libérera qu'à la fin de la transaction. Interblocage jusqu'au délai du pool.
 *
 * Ce défaut est invisible en développement, où la limite n'est pas posée.
 * D'où le paramètre plutôt qu'une règle à retenir.
 */
export interface ShippingGrids {
  zones: ShippingZoneGrid[]
  rates: ShippingRateGrid[]
}

/** Client Prisma ou client de transaction : les deux savent lire. */
type Reader = Prisma.TransactionClient | typeof prisma

const ZONE_SELECT = {
  code: true,
  name: true,
  countries: true,
  postalPrefixes: true,
  freeShippingThresholdCents: true,
  requiresCustoms: true,
  position: true,
} as const

const RATE_SELECT = {
  carrierCode: true,
  serviceCode: true,
  label: true,
  maxWeightGrams: true,
  priceCents: true,
  deliveryDaysMin: true,
  deliveryDaysMax: true,
  requiresServicePoint: true,
  zone: { select: { code: true } },
} as const

function readZones(client: Reader) {
  return client.shippingZone.findMany({
    orderBy: { position: 'asc' },
    select: ZONE_SELECT,
  })
}

function readRates(client: Reader) {
  // Un tarif désactivé n'est plus proposé. Il reste en base parce que des
  // commandes passées y font référence par leur instantané.
  return client.shippingRate.findMany({
    where: { active: true },
    orderBy: { maxWeightGrams: 'asc' },
    select: RATE_SELECT,
  })
}

export async function getShippingGrids(
  client: Reader = prisma,
): Promise<ShippingGrids> {
  // Hors transaction, on en ouvre une pour tenir les deux lectures ensemble.
  // Dedans, l'isolation de l'appelante s'en charge déjà — et en ouvrir une
  // seconde sur la même connexion est impossible.
  const [zoneRows, rateRows] =
    client === prisma
      ? await prisma.$transaction([readZones(prisma), readRates(prisma)])
      : [await readZones(client), await readRates(client)]

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
