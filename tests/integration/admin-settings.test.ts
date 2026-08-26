import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import {
  EDITABLE_SETTINGS,
  parseSettingInput,
  writeSettings,
  getSettings,
  getPricingConfig,
  DemoSettingsInProductionError,
} from '@/lib/config/settings'

/**
 * Les réglages métier, écrits depuis le back-office.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce lot devait rendre vrai
 * ---------------------------------------------------------------------------
 * Les nombres qui décident des prix — marge minimale visée, majoration de port,
 * barème de baisse — vivaient dans `prisma/seed.ts`, donc dans un dépôt public.
 * Ils n'y sont plus : le seed ne pose que des valeurs explicitement fictives, et
 * les vraies n'existent que dans la base, saisies par l'écran « Réglages ».
 *
 * Déplacer une configuration ne suffit pas : encore faut-il que le chemin
 * d'écriture soit aussi exigeant que le chemin de lecture, et que l'ouverture de
 * la boutique sur les valeurs de démonstration soit IMPOSSIBLE plutôt que
 * simplement déconseillée. C'est ce que ces tests verrouillent.
 */

/**
 * Les réglages qu'on remet dans leur état d'origine après chaque test.
 *
 * On ne relance pas le seed : il réécrit cinquante articles. On restaure les
 * seules lignes qu'on touche.
 */
const TOUCHED = [
  'minMarginCents',
  'shippingMarkupPercent',
  // Sert de valeur REFUSÉE dans le test du tout-ou-rien. Il doit figurer ici
  // quand même : le jour où le tout-ou-rien casse — ou pendant une campagne de
  // mutations qui l'enlève exprès — la valeur invalide est réellement écrite, et
  // sans restauration elle empoisonne toute la suite. C'est arrivé.
  'packagingWeightGrams',
  'autoDropSchedule',
  'autoAcceptThresholdPercent',
  'autoAcceptOffersEnabled',
  'settingsProfile',
] as const

let original: { key: string; value: unknown }[] = []

beforeEach(async () => {
  if (original.length === 0) {
    original = await prisma.setting.findMany({
      where: { key: { in: [...TOUCHED] } },
      select: { key: true, value: true },
    })
  }

  for (const row of original) {
    await prisma.setting.update({
      where: { key: row.key },
      data: { value: row.value as never },
    })
  }

  delete process.env.VERCEL_ENV
})

afterAll(async () => {
  for (const row of original) {
    await prisma.setting.update({
      where: { key: row.key },
      data: { value: row.value as never },
    })
  }
  delete process.env.VERCEL_ENV
  await prisma.$disconnect()
})

describe('parseSettingInput', () => {
  it('lit un barème écrit une ligne par palier', () => {
    expect(parseSettingInput('autoDropSchedule', '30:10\n60:20')).toEqual({
      ok: true,
      value: [
        { days: 30, percent: 10 },
        { days: 60, percent: 20 },
      ],
    })
  })

  it('trie les paliers, pour ne pas refuser un barème correct saisi à l’envers', () => {
    // Le schéma exige des remises croissantes avec l'ancienneté, mais dans
    // l'ordre où elles arrivent. Sans tri, une saisie du plus vieux au plus
    // jeune serait rejetée alors qu'elle décrit exactement le même barème.
    expect(parseSettingInput('autoDropSchedule', '60:20\n30:10')).toEqual({
      ok: true,
      value: [
        { days: 30, percent: 10 },
        { days: 60, percent: 20 },
      ],
    })
  })

  it('accepte un barème vide, qui désactive la baisse', () => {
    expect(parseSettingInput('autoDropSchedule', '')).toEqual({ ok: true, value: [] })
  })

  it('refuse un barème mal écrit plutôt que d’en deviner un', () => {
    expect(parseSettingInput('autoDropSchedule', '30 jours, 10 %')).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('lit un seuil vide comme « aucun seuil », pas comme zéro', () => {
    // Zéro voudrait dire « accepte toute offre » : l'inverse exact de
    // l'intention. C'est le seul champ numérique qu'on a le droit de vider.
    expect(parseSettingInput('autoAcceptThresholdPercent', '')).toEqual({
      ok: true,
      value: null,
    })
  })

  it('refuse une clé hors de la liste fermée', () => {
    // `withdrawalPeriodDays` est un délai LÉGAL. Il existe en base, il a un
    // schéma, il se lit — mais il ne s'édite pas ici.
    expect(parseSettingInput('withdrawalPeriodDays', '7')).toEqual({
      ok: false,
      reason: 'not-editable',
    })
  })
})

describe('la liste des réglages modifiables', () => {
  it('exclut ce qui engage juridiquement la boutique', () => {
    const editable = EDITABLE_SETTINGS.map((setting) => setting.key)

    // Ces quatre-là se changent avec un juriste ou en publiant de nouvelles
    // CGV, pas dans un formulaire entre deux commandes.
    expect(editable).not.toContain('withdrawalPeriodDays')
    expect(editable).not.toContain('returnShippingPaidByCustomer')
    expect(editable).not.toContain('refundOutboundShippingOnWithdrawal')
    expect(editable).not.toContain('cgvVersion')
  })

  it('exclut le marqueur de profil, qui est une conséquence et non un choix', () => {
    expect(EDITABLE_SETTINGS.map((s) => s.key)).not.toContain('settingsProfile')
  })

  it('contient bien les nombres qui ont motivé la sortie du dépôt', () => {
    const editable = EDITABLE_SETTINGS.map((setting) => setting.key)
    expect(editable).toContain('minMarginCents')
    expect(editable).toContain('shippingMarkupPercent')
    expect(editable).toContain('autoDropSchedule')
  })
})

describe('writeSettings', () => {
  it('écrit une valeur que la lecture sait relire', async () => {
    const written = await writeSettings([{ key: 'minMarginCents', value: 750 }])
    expect(written).toEqual({ ok: true, changed: ['minMarginCents'] })

    // Relu par le MÊME chemin que la boutique : c'est ce qui prouve que
    // l'écriture n'a pas produit une valeur que plus personne ne sait lire.
    const read = await getSettings(['minMarginCents'])
    expect(read.minMarginCents).toBe(750)
  })

  it('refuse une clé hors de la liste fermée, même valide par ailleurs', async () => {
    // Relu AVANT, et comparé à lui-même. Affirmer une valeur littérale — 14,
    // héritée du seed — rendait ce test dépendant du jeu de démonstration, donc
    // faux le jour où celui-ci change. Ce qui importe ici n'est pas la valeur du
    // délai de rétractation : c'est qu'il n'ait pas bougé.
    const before = await getSettings(['withdrawalPeriodDays'])

    const written = await writeSettings([
      { key: 'withdrawalPeriodDays', value: 7 },
    ])
    expect(written).toEqual({
      ok: false,
      key: 'withdrawalPeriodDays',
      reason: 'not-editable',
    })

    const after = await getSettings(['withdrawalPeriodDays'])
    expect(after).toEqual(before)
  })

  it('refuse ce que la LECTURE refuserait, avec le même schéma', async () => {
    // Remises décroissantes : une pièce de soixante-dix jours serait moins
    // remisée qu'une pièce de quarante-cinq. Le schéma de lecture le refuse ;
    // l'écriture doit le refuser aussi, sinon le réglage s'enregistre et la
    // boutique tombe au premier calcul de prix, en pointant la lecture.
    const written = await writeSettings([
      {
        key: 'autoDropSchedule',
        value: [
          { days: 30, percent: 20 },
          { days: 60, percent: 10 },
        ],
      },
    ])

    expect(written).toEqual({
      ok: false,
      key: 'autoDropSchedule',
      reason: 'invalid',
    })
  })

  it('n’écrit RIEN quand une seule valeur du lot est refusée', async () => {
    const before = await getSettings(['minMarginCents', 'shippingMarkupPercent'])

    const written = await writeSettings([
      { key: 'minMarginCents', value: 999 },
      { key: 'shippingMarkupPercent', value: 42 },
      // Un pourcentage négatif : `nonNegativeInt` le refuse.
      { key: 'packagingWeightGrams', value: -1 },
    ])
    expect(written.ok).toBe(false)

    // Le point du test : les deux premières valeurs étaient parfaitement
    // valides. Les écrire puis buter sur la troisième laisserait une
    // configuration MIXTE que personne n'a choisie — une marge neuve avec une
    // majoration ancienne — et rien ne le signalerait.
    const after = await getSettings(['minMarginCents', 'shippingMarkupPercent'])
    expect(after).toEqual(before)
  })
})

describe('le garde-fou de mise en service', () => {
  it('REFUSE de calculer un prix en production sur les valeurs de démonstration', async () => {
    await prisma.setting.update({
      where: { key: 'settingsProfile' },
      data: { value: 'development' },
    })
    process.env.VERCEL_ENV = 'production'

    // Sans ce refus, la boutique s'ouvrirait avec une marge cible et des coûts
    // transporteur inventés. Elle n'afficherait rien d'anormal : elle vendrait
    // à perte, pièce après pièce, jusqu'à ce que quelqu'un fasse les comptes.
    await expect(getPricingConfig()).rejects.toBeInstanceOf(
      DemoSettingsInProductionError,
    )
  })

  it('laisse passer une fois de vraies valeurs enregistrées', async () => {
    await prisma.setting.update({
      where: { key: 'settingsProfile' },
      data: { value: 'production' },
    })
    process.env.VERCEL_ENV = 'production'

    const config = await getPricingConfig()
    expect(config.minMarginCents).toEqual(expect.any(Number))
    // Le marqueur ne fuit pas dans la configuration rendue : `PricingConfig`
    // porte quatre nombres, et rien d'autre.
    expect(Object.keys(config).sort()).toEqual([
      'contributionRateBps',
      'minMarginCents',
      'stripeFixedCents',
      'stripePercentBps',
    ])
  })

  it('ne gêne ni le développement ni les déploiements de prévisualisation', async () => {
    await prisma.setting.update({
      where: { key: 'settingsProfile' },
      data: { value: 'development' },
    })

    // Hors production, le jeu de démonstration est exactement ce qu'on veut.
    process.env.VERCEL_ENV = 'preview'
    await expect(getPricingConfig()).resolves.toBeDefined()

    delete process.env.VERCEL_ENV
    await expect(getPricingConfig()).resolves.toBeDefined()
  })
})
