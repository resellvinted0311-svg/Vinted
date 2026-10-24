import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * L'identité légale d'une SOCIÉTÉ, et ce qu'elle exige avant de s'afficher.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier tient fermé
 * ---------------------------------------------------------------------------
 * Le modèle avait été écrit pour une micro-entreprise : nom, SIRET, adresse,
 * e-mail. Pour une SAS, le site se déclarait donc « complet » — CGV publiées,
 * acceptations horodatées, factures émises — en omettant la forme juridique,
 * le capital, le RCS, le téléphone et le directeur de la publication, que la
 * loi exige (LCEN art. 1-1 ; code de commerce art. R123-237). Rien ne le
 * signalait.
 *
 * `LEGAL` est figée au chargement du module : chaque cas pose ses variables
 * PUIS recharge le module, comme le ferait un déploiement.
 */

const VARIABLES = [
  'LEGAL_COMPANY_NAME',
  'LEGAL_FORM',
  'LEGAL_CAPITAL',
  'LEGAL_SIRET',
  'LEGAL_RCS_CITY',
  'LEGAL_ADDRESS',
  'LEGAL_EMAIL',
  'LEGAL_PHONE',
  'LEGAL_PUBLICATION_DIRECTOR',
  'LEGAL_VAT_NUMBER',
  'LEGAL_MEDIATOR_NAME',
  'LEGAL_MEDIATOR_ADDRESS',
  'LEGAL_MEDIATOR_URL',
] as const

const COMPLETE: Record<(typeof VARIABLES)[number], string> = {
  LEGAL_COMPANY_NAME: 'Nina & Diego',
  LEGAL_FORM: 'SAS',
  LEGAL_CAPITAL: '1 000 €',
  LEGAL_SIRET: '123 456 789 00012',
  LEGAL_RCS_CITY: 'Lille Métropole',
  LEGAL_ADDRESS: '12 rue du Registre, 59000 Lille',
  LEGAL_EMAIL: 'bonjour@boutique.test',
  LEGAL_PHONE: '03 20 00 00 00',
  LEGAL_PUBLICATION_DIRECTOR: 'Camille Exemple',
  LEGAL_VAT_NUMBER: '',
  LEGAL_MEDIATOR_NAME: 'Médiateur Exemple',
  LEGAL_MEDIATOR_ADDRESS: '1 place du Médiateur, 75000 Paris',
  LEGAL_MEDIATOR_URL: 'https://mediateur.test',
}

const sauvegarde: Partial<Record<string, string | undefined>> = {}

beforeEach(() => {
  for (const nom of VARIABLES) sauvegarde[nom] = process.env[nom]
})

afterEach(() => {
  for (const nom of VARIABLES) {
    const valeur = sauvegarde[nom]
    if (valeur === undefined) delete process.env[nom]
    else process.env[nom] = valeur
  }
  vi.resetModules()
})

async function charger(valeurs: Partial<Record<string, string>>) {
  for (const nom of VARIABLES) delete process.env[nom]
  for (const [nom, valeur] of Object.entries(valeurs)) process.env[nom] = valeur
  vi.resetModules()
  return import('@/lib/config/site')
}

describe('l’identité d’une société', () => {
  it('n’est PAS complète avec les quatre mentions d’une micro-entreprise', async () => {
    const site = await charger({
      LEGAL_COMPANY_NAME: COMPLETE.LEGAL_COMPANY_NAME,
      LEGAL_SIRET: COMPLETE.LEGAL_SIRET,
      LEGAL_ADDRESS: COMPLETE.LEGAL_ADDRESS,
      LEGAL_EMAIL: COMPLETE.LEGAL_EMAIL,
    })

    expect(site.hasLegalIdentity()).toBe(false)
    // Les NOMS de ce qui manque, pour que l'écran de mise en service dise
    // exactement quoi poser.
    expect(site.missingLegalKeys()).toEqual([
      'LEGAL_FORM',
      'LEGAL_CAPITAL',
      'LEGAL_RCS_CITY',
      'LEGAL_PHONE',
      'LEGAL_PUBLICATION_DIRECTOR',
    ])
  })

  it('est complète avec les neuf, sans exiger le numéro de TVA', async () => {
    // Une société en franchise en base n'a pas toujours de numéro de TVA :
    // l'exiger bloquerait une boutique en règle.
    const site = await charger(COMPLETE)

    expect(site.missingLegalKeys()).toEqual([])
    expect(site.hasLegalIdentity()).toBe(true)
  })

  it('ne compte pas une valeur faite d’espaces comme renseignée', async () => {
    // Un espace collé dans l'interface de l'hébergeur ne doit pas suffire à
    // publier des mentions vides.
    const site = await charger({ ...COMPLETE, LEGAL_PHONE: '   ' })

    expect(site.missingLegalKeys()).toEqual(['LEGAL_PHONE'])
  })

  it('écrit la mention RCS avec le SIREN déduit du SIRET', async () => {
    const site = await charger(COMPLETE)

    expect(site.rcsMention()).toBe('RCS Lille Métropole 123 456 789')
    // Saisi sans espaces, le résultat est le même.
    expect(site.sirenFromSiret('12345678900012')).toBe('123 456 789')
  })
})

describe('le médiateur', () => {
  it('exige le nom, l’adresse postale ET le site', async () => {
    // F33338 : « nom, adresse postale et adresse du site internet ». Le nom
    // seul suffisait à l'ancien test, et la page se disait renseignée.
    const site = await charger({ ...COMPLETE, LEGAL_MEDIATOR_ADDRESS: '' })

    expect(site.hasMediator()).toBe(false)
    expect(site.missingMediatorKeys()).toEqual(['LEGAL_MEDIATOR_ADDRESS'])
    // Il reste vérifié à part : son absence ne masque pas l'identité.
    expect(site.hasLegalIdentity()).toBe(true)
    expect(site.isLegallyComplete()).toBe(false)
  })

  it('complet, il rend l’identité légalement complète', async () => {
    const site = await charger(COMPLETE)

    expect(site.hasMediator()).toBe(true)
    expect(site.isLegallyComplete()).toBe(true)
  })
})

describe('la facture d’une société', () => {
  it('porte la forme, le capital et le RCS', async () => {
    await charger(COMPLETE)
    const { buildInvoice } = await import('@/lib/shop/invoice')

    const facture = buildInvoice({
      orderNumber: 'CMD-2026-000042',
      invoiceNumber: 'FA-000007',
      email: 'acheteuse@exemple.fr',
      billingAddress: null,
      shippingAddress: null,
      subtotalCents: 4500,
      discountCents: 0,
      shippingCents: 415,
      totalCents: 4915,
      paidAt: new Date('2026-10-24T10:00:00Z'),
      createdAt: new Date('2026-10-24T09:55:00Z'),
      items: [
        {
          titleSnapshot: 'Veste en laine',
          unitPriceCents: 4500,
          article: { sku: 'ND-0142' },
        },
      ],
    })

    expect(facture.seller.legalForm).toBe('SAS')
    expect(facture.seller.shareCapital).toBe('1 000 €')
    expect(facture.seller.rcs).toBe('RCS Lille Métropole 123 456 789')
    // Absent, le numéro de TVA n'est pas écrit — ni inventé.
    expect(facture.seller.vatNumber).toBeNull()
  })

  it('ne dépend ni du téléphone ni du directeur de la publication', async () => {
    // Exigés sur le site par la LCEN, pas sur une facture : une commande
    // payée doit recevoir son numéro même si ces deux lignes manquent.
    const site = await charger({
      ...COMPLETE,
      LEGAL_PHONE: '',
      LEGAL_PUBLICATION_DIRECTOR: '',
    })

    expect(site.hasLegalIdentity()).toBe(false)
    expect(site.hasInvoiceIdentity()).toBe(true)
  })

  it('refuse d’être émise tant que l’identité de la société est incomplète', async () => {
    await charger({ ...COMPLETE, LEGAL_CAPITAL: '' })
    const { buildInvoice, LegalIdentityMissingError } =
      await import('@/lib/shop/invoice')

    expect(() =>
      buildInvoice({
        orderNumber: 'CMD-2026-000043',
        invoiceNumber: 'FA-000008',
        email: 'acheteuse@exemple.fr',
        billingAddress: null,
        shippingAddress: null,
        subtotalCents: 1000,
        discountCents: 0,
        shippingCents: 0,
        totalCents: 1000,
        paidAt: null,
        createdAt: new Date(),
        items: [],
      }),
    ).toThrow(LegalIdentityMissingError)
  })
})
