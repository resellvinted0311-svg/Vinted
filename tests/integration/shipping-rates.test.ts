import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  ecrireGrilles,
  grillesSchema,
  lireGrillesEditables,
} from '@/lib/admin/shipping-rates'

/**
 * Les tarifs de port corrigés depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Le cul-de-sac que cet écran ouvre
 * ---------------------------------------------------------------------------
 * `prisma/seed-data/shipping.ts` annonce que ses montants sont fictifs et que
 * « les vrais tarifs vivent dans la table `ShippingRate` de la base de
 * production ». Rien ne permettait de les y écrire : la boutique facturait des
 * prix de port inventés, et le seul chemin vers un prix juste passait par
 * l'édition d'un fichier d'un dépôt public.
 *
 * Ce qui suit tient fermé ce que l'écriture a le droit de faire — et surtout
 * ce qu'elle doit refuser.
 */

const PREFIXE = 'TEST_PORT_'

async function zoneDeTest(suffixe: string) {
  const zone = await prisma.shippingZone.create({
    data: {
      code: `${PREFIXE}${suffixe}`,
      name: `Zone d’essai ${suffixe}`,
      countries: ['ZZ'],
      position: 900,
      freeShippingThresholdCents: 5000,
      rates: {
        create: [
          {
            carrierCode: 'essai',
            serviceCode: 'ESSAI',
            label: 'Service d’essai',
            maxWeightGrams: 500,
            priceCents: 420,
            deliveryDaysMin: 2,
            deliveryDaysMax: 4,
          },
          {
            carrierCode: 'essai',
            serviceCode: 'ESSAI',
            label: 'Service d’essai',
            maxWeightGrams: 1000,
            priceCents: 480,
            deliveryDaysMin: 2,
            deliveryDaysMax: 4,
          },
        ],
      },
    },
    select: { id: true, rates: { select: { id: true, maxWeightGrams: true } } },
  })

  return {
    zoneId: zone.id,
    petit: zone.rates.find((r) => r.maxWeightGrams === 500)!.id,
    grand: zone.rates.find((r) => r.maxWeightGrams === 1000)!.id,
  }
}

beforeEach(async () => {
  await prisma.shippingZone.deleteMany({
    where: { code: { startsWith: PREFIXE } },
  })
})

afterAll(async () => {
  await prisma.shippingZone.deleteMany({
    where: { code: { startsWith: PREFIXE } },
  })
  await prisma.$disconnect()
})

describe('ce que l’écriture refuse', () => {
  it('refuse un prix NÉGATIF', () => {
    /*
      Le défaut le plus coûteux que ce formulaire puisse produire.

      Un coût de port négatif ne fait pas échouer le devis : il le REND, en
      négatif. Le total de la commande baisse d'autant — c'est-à-dire que la
      boutique paierait l'acheteuse pour se faire prendre un vêtement, et rien
      dans le tunnel ne le signalerait.
    */
    const refus = grillesSchema.safeParse({
      tarifs: [{ id: 'x', priceCents: -100, active: true }],
      zones: [],
    })

    expect(refus.success).toBe(false)
  })

  it('refuse un prix absurde, qui est une faute de frappe', () => {
    // « 420 » saisi dans un champ en euros au lieu de « 4,20 ». Sans borne,
    // la première commande vers cette zone facturerait 420 € de port.
    const refus = grillesSchema.safeParse({
      tarifs: [{ id: 'x', priceCents: 42_000_000, active: true }],
      zones: [],
    })

    expect(refus.success).toBe(false)
  })

  it('refuse un prix à virgule — les centimes sont des entiers', () => {
    const refus = grillesSchema.safeParse({
      tarifs: [{ id: 'x', priceCents: 420.5, active: true }],
      zones: [],
    })

    expect(refus.success).toBe(false)
  })

  it('accepte un seuil de gratuité ABSENT, qui est une valeur', () => {
    // `null` veut dire « le port n'est jamais offert sur cette zone » — c'est
    // le cas de l'outre-mer. Le confondre avec un champ oublié rendrait la
    // gratuité impossible à retirer.
    const ok = grillesSchema.safeParse({
      tarifs: [],
      zones: [{ id: 'z', freeShippingThresholdCents: null }],
    })

    expect(ok.success).toBe(true)
  })
})

describe('ce qui est réellement écrit', () => {
  it('écrit le prix et l’activation, et rend ce qui a bougé', async () => {
    const { zoneId, petit, grand } = await zoneDeTest('a')

    const modifies = await prisma.$transaction((tx) =>
      ecrireGrilles(tx, {
        tarifs: [
          { id: petit, priceCents: 500, active: true },
          { id: grand, priceCents: 480, active: false },
        ],
        zones: [{ id: zoneId, freeShippingThresholdCents: 6000 }],
      }),
    )

    expect(modifies.tarifs.sort()).toEqual([petit, grand].sort())
    expect(modifies.zones).toEqual([zoneId])

    const apres = await prisma.shippingRate.findMany({
      where: { id: { in: [petit, grand] } },
      select: { id: true, priceCents: true, active: true },
    })
    expect(apres.find((r) => r.id === petit)).toMatchObject({
      priceCents: 500,
      active: true,
    })
    // Le grand palier n'a pas changé de PRIX, mais il a été désactivé : il
    // compte donc comme modifié.
    expect(apres.find((r) => r.id === grand)).toMatchObject({
      priceCents: 480,
      active: false,
    })
  })

  it('ne consigne RIEN quand on réenregistre sans rien toucher', async () => {
    /*
      L'écran renvoie toutes les lignes à chaque enregistrement. Sans cette
      comparaison, corriger un seul prix inscrirait trente-deux modifications à
      la piste d'audit — qui deviendrait illisible au bout d'un mois, et à
      laquelle on fait pourtant confiance pour reconstituer un geste six mois
      plus tard.
    */
    const { zoneId, petit, grand } = await zoneDeTest('b')

    const modifies = await prisma.$transaction((tx) =>
      ecrireGrilles(tx, {
        tarifs: [
          { id: petit, priceCents: 420, active: true },
          { id: grand, priceCents: 480, active: true },
        ],
        zones: [{ id: zoneId, freeShippingThresholdCents: 5000 }],
      }),
    )

    expect(modifies).toEqual({ tarifs: [], zones: [] })
  })

  it('ignore une ligne disparue au lieu de tout faire échouer', async () => {
    /*
      Une ligne supprimée entre le rendu de l'écran et l'envoi du formulaire.
      Faire échouer l'enregistrement entier ferait perdre la correction des
      autres lignes pour une ligne que plus personne ne facture.
    */
    const { zoneId, petit } = await zoneDeTest('c')

    const modifies = await prisma.$transaction((tx) =>
      ecrireGrilles(tx, {
        tarifs: [
          { id: petit, priceCents: 999, active: true },
          { id: 'identifiant-qui-nexiste-pas', priceCents: 100, active: true },
        ],
        zones: [{ id: zoneId, freeShippingThresholdCents: 5000 }],
      }),
    )

    expect(modifies.tarifs).toEqual([petit])
  })

  it('retire la gratuité quand le seuil passe à vide', async () => {
    const { zoneId } = await zoneDeTest('d')

    await prisma.$transaction((tx) =>
      ecrireGrilles(tx, {
        tarifs: [],
        zones: [{ id: zoneId, freeShippingThresholdCents: null }],
      }),
    )

    const apres = await prisma.shippingZone.findUniqueOrThrow({
      where: { id: zoneId },
      select: { freeShippingThresholdCents: true },
    })
    expect(apres.freeShippingThresholdCents).toBeNull()
  })
})

describe('ce que l’écran donne à lire', () => {
  it('montre AUSSI les tarifs désactivés', async () => {
    /*
      Le tunnel de commande ne lit que les tarifs actifs — c'est correct, un
      palier désactivé ne doit pas être proposé. Mais cet écran est celui
      depuis lequel on les rallume : un palier qu'on ne voit plus est un palier
      qu'on ne peut plus réactiver, et il n'existe aucun autre chemin.
    */
    const { zoneId, petit } = await zoneDeTest('e')
    await prisma.shippingRate.update({
      where: { id: petit },
      data: { active: false },
    })

    const zones = await lireGrillesEditables()
    const zone = zones.find((z) => z.id === zoneId)

    expect(zone?.tarifs).toHaveLength(2)
    expect(zone?.tarifs.find((t) => t.id === petit)?.active).toBe(false)
  })
})
