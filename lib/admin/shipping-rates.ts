import 'server-only'

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

/**
 * Les tarifs de port, tels qu'on les corrige depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Le cul-de-sac que ce module ouvre
 * ---------------------------------------------------------------------------
 * `prisma/seed-data/shipping.ts` annonce, en toutes lettres, que ses montants
 * sont fictifs, qu'ils ne doivent JAMAIS être remplacés par les tarifs
 * réellement négociés, et que « les vrais tarifs vivent dans la table
 * `ShippingRate` de la base de production ».
 *
 * Rien ne permettait de les y écrire. Aucun écran, aucune route. Le seul chemin
 * vers un tarif juste passait donc par l'édition d'un fichier du dépôt et un
 * redéploiement — exactement ce que ce fichier interdit, et pour une bonne
 * raison : un coût transporteur croisé avec la majoration réglée donne au
 * centime près ce que la boutique encaisse sur chaque colis. C'est un chiffre
 * d'exploitation, et le dépôt est public.
 *
 * Le dépôt a déjà connu ce motif une fois : `floorShippingZoneCode` était
 * obligatoire pour vendre et absent du formulaire. Un réglage obligatoire
 * qu'aucun écran ne peut poser est un cul-de-sac, et celui-ci coûtait plus
 * cher — il laissait facturer des prix inventés.
 *
 * ---------------------------------------------------------------------------
 * Ce qui est modifiable, et ce qui ne l'est délibérément PAS
 * ---------------------------------------------------------------------------
 * Modifiable : le PRIX d'un palier, son ACTIVATION, et le seuil de gratuité
 * d'une zone. Ce sont les trois nombres qui décident de ce qu'on facture.
 *
 * Pas modifiable ici : les zones, les pays qu'elles couvrent, les préfixes
 * postaux, les paliers de poids, les transporteurs, les délais. Ce sont des
 * données de STRUCTURE, et s'y tromper ne coûte pas quelques centimes : retirer
 * un pays d'une zone le fait disparaître de la liste du tunnel de commande, et
 * les personnes qui y vivent ne peuvent plus commander du tout — sans qu'aucun
 * message ne dise pourquoi.
 *
 * Les ouvrir demanderait un écran qui sait prévenir de cela. Ce n'est pas ce
 * qui manquait pour vendre.
 *
 * ---------------------------------------------------------------------------
 * `priceCents` est un COÛT, pas un prix de vente
 * ---------------------------------------------------------------------------
 * C'est le tarif du transporteur. Ce que l'acheteuse paie en est dérivé par
 * `Setting.shippingMarkupPercent`, réglé sur l'autre écran. Ne jamais confondre
 * les deux : saisir ici le prix qu'on veut facturer ferait appliquer la
 * majoration par-dessus, et la boutique facturerait deux fois sa marge.
 */

/** Un palier de poids, tel qu'il se corrige. */
export interface TarifEditable {
  id: string
  carrierCode: string
  serviceCode: string
  label: string
  maxWeightGrams: number
  /** Coût transporteur, en centimes. */
  priceCents: number
  active: boolean
  deliveryDaysMin: number
  deliveryDaysMax: number
  requiresServicePoint: boolean
}

/** Une zone et ses paliers, groupés comme on les lit. */
export interface ZoneEditable {
  id: string
  code: string
  name: string
  /** Au-delà, le port est offert. `null` = jamais offert sur cette zone. */
  freeShippingThresholdCents: number | null
  requiresCustoms: boolean
  tarifs: TarifEditable[]
}

/**
 * Le plafond d'un tarif, et pourquoi il y en a un.
 *
 * Mille euros de port sur un vêtement n'est pas un tarif, c'est une faute de
 * frappe — un « 420 » saisi dans un champ en euros au lieu de « 4,20 ». Sans
 * borne, elle passerait, et la première commande vers cette zone facturerait
 * une somme absurde que personne ne paierait. On refuse la saisie plutôt que
 * de la découvrir sur une commande perdue.
 *
 * La borne est haute exprès : elle n'arbitre pas ce qui est cher, elle attrape
 * ce qui est impossible.
 */
const PRIX_MAXIMUM_CENTS = 100_000

/** Idem pour le seuil de gratuité : au-delà, c'est une erreur de saisie. */
const SEUIL_MAXIMUM_CENTS = 1_000_000

/**
 * Ce qu'un enregistrement a le droit de contenir.
 *
 * Validé ici et pas seulement dans l'action : une Server Action est un POST que
 * n'importe quel appelant peut former, et le formulaire n'est pas une
 * validation. Un prix négatif écrit en base ferait facturer un port négatif,
 * donc réduirait le total d'une commande — c'est-à-dire se paierait à
 * l'acheteur.
 */
export const tarifSchema = z.object({
  id: z.string().min(1),
  priceCents: z.number().int().min(0).max(PRIX_MAXIMUM_CENTS),
  active: z.boolean(),
})

export const zoneSchema = z.object({
  id: z.string().min(1),
  // `null` est une valeur, pas une absence : elle veut dire « le port n'est
  // jamais offert sur cette zone », ce qui est le cas de l'outre-mer.
  freeShippingThresholdCents: z
    .number()
    .int()
    .min(0)
    .max(SEUIL_MAXIMUM_CENTS)
    .nullable(),
})

export const grillesSchema = z.object({
  tarifs: z.array(tarifSchema).max(500),
  zones: z.array(zoneSchema).max(50),
})

export type GrillesInput = z.infer<typeof grillesSchema>

/**
 * Lit les grilles pour l'écran.
 *
 * Les tarifs INACTIFS sont inclus, contrairement à la lecture du tunnel de
 * commande : c'est l'écran depuis lequel on les réactive, et un palier qu'on ne
 * voit plus est un palier qu'on ne peut plus rallumer.
 */
export async function lireGrillesEditables(): Promise<ZoneEditable[]> {
  const zones = await prisma.shippingZone.findMany({
    orderBy: { position: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      freeShippingThresholdCents: true,
      requiresCustoms: true,
      rates: {
        orderBy: [
          { carrierCode: 'asc' },
          { serviceCode: 'asc' },
          { maxWeightGrams: 'asc' },
        ],
        select: {
          id: true,
          carrierCode: true,
          serviceCode: true,
          label: true,
          maxWeightGrams: true,
          priceCents: true,
          active: true,
          deliveryDaysMin: true,
          deliveryDaysMax: true,
          requiresServicePoint: true,
        },
      },
    },
  })

  return zones.map((zone) => ({
    id: zone.id,
    code: zone.code,
    name: zone.name,
    freeShippingThresholdCents: zone.freeShippingThresholdCents,
    requiresCustoms: zone.requiresCustoms,
    tarifs: zone.rates,
  }))
}

/** Ce qu'une écriture a réellement changé, pour la piste d'audit. */
export interface GrillesModifiees {
  tarifs: string[]
  zones: string[]
}

/**
 * Écrit les grilles, et rend la liste de ce qui a BOUGÉ.
 *
 * Seules les lignes réellement différentes sont écrites. Deux raisons, et la
 * seconde est la vraie : l'écran renvoie toutes les lignes à chaque
 * enregistrement, et consigner trente-deux modifications chaque fois qu'on
 * corrige un prix rendrait la piste d'audit illisible au bout d'un mois.
 *
 * Aucune VALEUR n'est consignée par l'appelant — le même raisonnement que pour
 * les réglages : recopier les montants dans une table conservée dix ans
 * dupliquerait précisément ce qu'on vient de sortir du dépôt.
 */
export async function ecrireGrilles(
  tx: Prisma.TransactionClient,
  input: GrillesInput,
): Promise<GrillesModifiees> {
  const modifies: GrillesModifiees = { tarifs: [], zones: [] }

  /*
    Les lignes d'AVANT, en une seule lecture.

    Une comparaison ligne par ligne ferait trente-deux allers-retours dans une
    transaction, sur une base qui n'accorde qu'une connexion par instance en
    production. Le défaut est invisible en développement, où la limite n'est
    pas posée — c'est le raisonnement déjà écrit en tête de
    `lib/db/queries/shipping.ts`.
  */
  const avantTarifs = await tx.shippingRate.findMany({
    where: { id: { in: input.tarifs.map((t) => t.id) } },
    select: { id: true, priceCents: true, active: true },
  })
  const parId = new Map(avantTarifs.map((t) => [t.id, t]))

  for (const tarif of input.tarifs) {
    const avant = parId.get(tarif.id)

    // Un identifiant inconnu n'est pas une erreur à remonter : c'est une ligne
    // supprimée entre le rendu de l'écran et l'envoi du formulaire. On
    // l'ignore plutôt que de faire échouer la correction des trente et une
    // autres.
    if (!avant) continue

    if (
      avant.priceCents === tarif.priceCents &&
      avant.active === tarif.active
    ) {
      continue
    }

    await tx.shippingRate.update({
      where: { id: tarif.id },
      data: { priceCents: tarif.priceCents, active: tarif.active },
    })
    modifies.tarifs.push(tarif.id)
  }

  const avantZones = await tx.shippingZone.findMany({
    where: { id: { in: input.zones.map((z) => z.id) } },
    select: { id: true, freeShippingThresholdCents: true },
  })
  const zoneParId = new Map(avantZones.map((z) => [z.id, z]))

  for (const zone of input.zones) {
    const avant = zoneParId.get(zone.id)
    if (!avant) continue
    if (avant.freeShippingThresholdCents === zone.freeShippingThresholdCents) {
      continue
    }

    await tx.shippingZone.update({
      where: { id: zone.id },
      data: { freeShippingThresholdCents: zone.freeShippingThresholdCents },
    })
    modifies.zones.push(zone.id)
  }

  return modifies
}
