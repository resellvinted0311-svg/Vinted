import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  inventorierDemonstration,
  retirerDemonstration,
} from '@/lib/admin/demonstration'
import { DEMO_SOURCING_PLACES } from '../../prisma/seed-data/fixtures'

/**
 * Le retrait du jeu de démonstration, et surtout ce qu'il NE supprime PAS.
 *
 * ---------------------------------------------------------------------------
 * Le coût des deux erreurs n'est pas le même
 * ---------------------------------------------------------------------------
 * Laisser une pièce de démonstration en vente se répare en relançant le
 * retrait. Supprimer une vraie pièce détruit sa fiche, ses traductions, ses
 * mesures, ses photos et ses négociations — et rien ne les reconstitue.
 *
 * Tout ce fichier penche donc du même côté : au moindre doute, on ne supprime
 * pas.
 */

const LIEU_DEMO = DEMO_SOURCING_PLACES[0]
const MARQUEUR = 'DEMO-TEST-'

/*
  Une plage à nous, DISJOINTE des cinquante pièces réellement semées.

  Les deux bornes comptent. Avec un simple plafond posé au-dessus de la plage
  réelle, la plage de test l'englobait — et le test de suppression effaçait les
  cinquante pièces du catalogue de développement, sur lesquelles tournent les
  autres fichiers et toute la suite de bout en bout. Le défaut n'est apparu
  qu'en lançant le script pour de vrai ; ces tests-ci passaient.

  Sans elle, ces tests entreraient en collision avec `ART-000001`…`ART-000050`
  sur l'unicité du numéro — et, pire, le test de suppression viderait le
  catalogue de démonstration sur lequel tournent les autres fichiers et toute
  la suite de bout en bout.
*/
const BORNES = { premierNumero: 900_001, dernierNumero: 900_999 }
const DANS_LA_PLAGE = (n: number) => `ART-${900_000 + n}`
const HORS_PLAGE = 'ART-901000'

async function piece(options: {
  sku: string
  sourcedFrom: string | null
  titre: string
}) {
  const category = await prisma.category.findFirstOrThrow({
    select: { id: true },
  })

  return prisma.article.create({
    data: {
      sku: options.sku,
      slug: `${MARQUEUR}${options.sku}`.toLowerCase(),
      condition: 'GOOD',
      sizeLabel: 'M',
      sizeNormalized: 'M',
      priceCents: 2000,
      costCents: 600,
      floorPriceCents: 1200,
      weightGrams: 400,
      status: 'AVAILABLE',
      categoryId: category.id,
      sourcedFrom: options.sourcedFrom,
      translations: {
        create: { locale: 'fr', title: options.titre, description: 'Essai.' },
      },
    },
    select: { id: true },
  })
}

async function menage() {
  await prisma.article.deleteMany({
    where: { slug: { startsWith: MARQUEUR.toLowerCase() } },
  })
}

beforeEach(menage)

afterAll(async () => {
  await menage()
  await prisma.$disconnect()
})

describe('ce qui est reconnu comme une pièce de démonstration', () => {
  it('exige les DEUX marques, jamais une seule', async () => {
    /*
      Le cœur du fichier.

      Une pièce importée depuis l'application de gestion reçoit exactement le
      même format de numéro : `ART-000051` suit `ART-000050` sur le même
      compteur. Le numéro seul ne distingue donc rien.

      Et un lieu d'approvisionnement seul ne suffit pas non plus : rien
      n'empêche une vraie pièce de porter un nom de brocante.
    */
    const numeroSeul = await piece({
      sku: DANS_LA_PLAGE(7),
      sourcedFrom: 'vide-grenier réel du dimanche',
      titre: 'Vraie pièce, lieu réel',
    })
    const lieuSeul = await piece({
      sku: HORS_PLAGE,
      sourcedFrom: LIEU_DEMO,
      titre: 'Vraie pièce, lieu homonyme',
    })
    const lesDeux = await piece({
      sku: DANS_LA_PLAGE(8),
      sourcedFrom: LIEU_DEMO,
      titre: 'Fausse pièce',
    })

    const { retirables } = await inventorierDemonstration(BORNES)
    const ids = retirables.map((p) => p.id)

    expect(ids).toContain(lesDeux.id)
    expect(ids).not.toContain(numeroSeul.id)
    expect(ids).not.toContain(lieuSeul.id)
  })

  it('ignore une pièce sans lieu d’approvisionnement', async () => {
    // Le cas d'un import qui ne renseigne pas ce champ : il ne doit pas suffire
    // d'avoir un petit numéro pour être pris pour un faux.
    const sansLieu = await piece({
      sku: DANS_LA_PLAGE(9),
      sourcedFrom: null,
      titre: 'Importée sans provenance',
    })

    const { retirables } = await inventorierDemonstration(BORNES)
    expect(retirables.map((p) => p.id)).not.toContain(sansLieu.id)
  })
})

describe('ce qui ne peut pas être supprimé', () => {
  it('met de côté une pièce qu’une commande référence', async () => {
    /*
      `OrderItem.article` est en `onDelete: Restrict` : la base refuse. C'est
      juste — une ligne comptable qui ne désigne plus rien ne vaut rien, et
      l'obligation de conservation porte sur dix ans.

      Le retrait doit donc la RECONNAÎTRE et la signaler, pas se lancer dans
      une suppression qui échouera et emportera les quarante-neuf autres avec
      elle.
    */
    const commandee = await piece({
      sku: DANS_LA_PLAGE(10),
      sourcedFrom: LIEU_DEMO,
      titre: 'Fausse pièce, mais commandée',
    })

    const order = await prisma.order.create({
      data: {
        orderNumber: `${MARQUEUR}CMD`,
        status: 'PAID',
        locale: 'fr',
        email: 'essai@exemple.test',
        subtotalCents: 2000,
        shippingCents: 0,
        totalCents: 2000,
        shippingCarrierCode: 'essai',
        shippingServiceCode: 'ESSAI',
        shippingAddress: {
          name: 'Essai',
          line1: '1 rue',
          postalCode: '59000',
          city: 'Lille',
          country: 'FR',
        },
        billingAddress: {
          name: 'Essai',
          line1: '1 rue',
          postalCode: '59000',
          city: 'Lille',
          country: 'FR',
        },
        items: {
          create: {
            articleId: commandee.id,
            titleSnapshot: 'Fausse pièce, mais commandée',
            imageSnapshot: '',
            unitPriceCents: 2000,
            costCentsSnapshot: 600,
          },
        },
      },
      select: { id: true },
    })

    try {
      const { retirables, bloquees } = await inventorierDemonstration(BORNES)

      expect(bloquees.map((p) => p.id)).toContain(commandee.id)
      expect(retirables.map((p) => p.id)).not.toContain(commandee.id)
    } finally {
      await prisma.order.delete({ where: { id: order.id } })
    }
  })
})

describe('ce que la suppression fait réellement', () => {
  it('supprime les faux et laisse les vrais, puis est sans effet au second passage', async () => {
    const faux = await piece({
      sku: DANS_LA_PLAGE(11),
      sourcedFrom: LIEU_DEMO,
      titre: 'Fausse pièce',
    })
    const vrai = await piece({
      sku: HORS_PLAGE,
      sourcedFrom: LIEU_DEMO,
      titre: 'Vraie pièce, hors plage',
    })

    const supprimees = await retirerDemonstration(BORNES)
    expect(supprimees).toBeGreaterThanOrEqual(1)

    expect(
      await prisma.article.findUnique({ where: { id: faux.id } }),
    ).toBeNull()
    expect(
      await prisma.article.findUnique({ where: { id: vrai.id } }),
    ).not.toBeNull()

    // Relancé, il ne trouve plus rien : le retrait est sûr à rejouer, ce qui
    // est exactement ce qu'on veut d'un script qu'on lance la peur au ventre.
    expect(await retirerDemonstration(BORNES)).toBe(0)
  })

  it('emporte les traductions de la pièce supprimée', async () => {
    // Relation en cascade : sans elle, la base garderait des lignes orphelines
    // qui ne désignent plus rien.
    const faux = await piece({
      sku: DANS_LA_PLAGE(12),
      sourcedFrom: LIEU_DEMO,
      titre: 'Fausse pièce à traduire',
    })

    await retirerDemonstration(BORNES)

    expect(
      await prisma.articleTranslation.count({ where: { articleId: faux.id } }),
    ).toBe(0)
  })
})
