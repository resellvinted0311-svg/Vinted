import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { prisma } from '@/lib/db/client'
import {
  EDITABLE_SETTINGS,
  PRICING_SETTING_KEYS,
  parseSettingInput,
  writeSettings,
  getSettings,
  getPricingConfig,
  findMissingSettings,
  MissingSettingError,
  DemoSettingsInProductionError,
} from '@/lib/config/settings'
import { SYNC_SETTING_KEYS } from '@/lib/sync/articles'

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

  // `upsert` : un test peut SUPPRIMER une ligne — c'est même le seul moyen
  // d'exercer le cas d'une base plus ancienne que le code. Une restauration par
  // `update` échouerait alors, et le réglage manquerait à toute la suite.
  for (const row of original) {
    await prisma.setting.upsert({
      where: { key: row.key },
      update: { value: row.value as never },
      create: { key: row.key, value: row.value as never },
    })
  }

  delete process.env.VERCEL_ENV
})

afterAll(async () => {
  for (const row of original) {
    await prisma.setting.upsert({
      where: { key: row.key },
      update: { value: row.value as never },
      create: { key: row.key, value: row.value as never },
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

  it('couvre TOUT ce sans quoi la boutique refuse de calculer un prix', () => {
    /**
     * L'invariant qui manquait, et ce qu'il a coûté.
     *
     * `floorShippingZoneCode` était obligatoire pour vendre ET absent de ce
     * formulaire. Sa ligne manquait en production : la boutique refusait de
     * calculer un prix, l'import répondait 503, et aucun écran ne permettait de
     * poser la valeur. Un réglage obligatoire que l'interface ne peut pas
     * renseigner est un cul-de-sac, pas une protection — et rien ici ne
     * l'interdisait.
     *
     * Ce test l'interdit. Le jour où un réglage obligatoire s'ajoute sans son
     * champ, il échoue AVANT la mise en service, et non après.
     *
     * `settingsProfile` est la seule exception admise : il n'est pas un choix
     * mais une conséquence de l'enregistrement, et il est écrit d'office.
     */
    const editable = new Set<string>(EDITABLE_SETTINGS.map((s) => s.key))
    const requis = [...PRICING_SETTING_KEYS, ...SYNC_SETTING_KEYS]

    const orphelins = requis.filter(
      (key) => key !== 'settingsProfile' && !editable.has(key),
    )

    expect(orphelins).toEqual([])
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

// ---------------------------------------------------------------------------
// Une base plus ancienne que le code
// ---------------------------------------------------------------------------

/**
 * Un réglage ajouté APRÈS la mise en service n'a pas de ligne.
 *
 * Une migration crée des tables, pas des lignes ; et le seed qui l'aurait posée
 * ne tourne qu'à la demande. Écrire une valeur validée dans une ligne absente
 * est donc le cas NORMAL d'une base déployée avant que le réglage n'existe.
 *
 * `update` y levait P2025, ce qui annulait la transaction ENTIÈRE : aucun
 * réglage n'était enregistré, l'écran rendait une erreur, et la boutique restait
 * bloquée sur ses chiffres de démonstration — sans moyen d'en sortir par
 * l'interface faite pour ça. C'est arrivé en production, le jour de la mise en
 * service.
 */
describe('un réglage dont la ligne n’existe pas encore', () => {
  it('est CRÉÉ, au lieu de faire échouer tout l’enregistrement', async () => {
    await prisma.setting.delete({ where: { key: 'shippingMarkupPercent' } })

    const result = await writeSettings([
      { key: 'shippingMarkupPercent', value: 12 },
    ])

    expect(result.ok).toBe(true)

    const ecrit = await prisma.setting.findUnique({
      where: { key: 'shippingMarkupPercent' },
    })
    expect(ecrit?.value).toBe(12)
  })

  it('n’entraîne PAS les autres réglages du même envoi dans sa chute', async () => {
    // Le tout-ou-rien reste vrai pour une valeur INVALIDE — c'est sa raison
    // d'être. Il ne doit pas se déclencher pour une ligne simplement absente,
    // qui n'a rien d'une erreur de saisie.
    await prisma.setting.delete({ where: { key: 'shippingMarkupPercent' } })

    const result = await writeSettings([
      { key: 'minMarginCents', value: 700 },
      { key: 'shippingMarkupPercent', value: 18 },
    ])

    expect(result.ok).toBe(true)

    const rows = await prisma.setting.findMany({
      where: { key: { in: ['minMarginCents', 'shippingMarkupPercent'] } },
      select: { key: true, value: true },
    })
    expect(new Map(rows.map((r) => [r.key, r.value]))).toEqual(
      new Map([
        ['minMarginCents', 700],
        ['shippingMarkupPercent', 18],
      ]),
    )
  })
})

/**
 * Le diagnostic, et pourquoi il vaut mieux que le premier fautif.
 *
 * Une base plus ancienne que le code n'a presque jamais UNE ligne en retard.
 * S'arrêter à la première obligeait à corriger, relancer un import complet,
 * découvrir la suivante, recommencer — un aller-retour par ligne, chacun payé
 * d'un import.
 */
describe('les réglages absents', () => {
  it('sont TOUS nommés, et pas seulement le premier', async () => {
    await prisma.setting.delete({ where: { key: 'shippingMarkupPercent' } })
    await prisma.setting.delete({ where: { key: 'packagingWeightGrams' } })

    const erreur = await getSettings([
      'minMarginCents',
      'shippingMarkupPercent',
      'packagingWeightGrams',
    ]).catch((error: unknown) => error)

    expect(erreur).toBeInstanceOf(MissingSettingError)
    const missing = erreur as MissingSettingError
    expect([...missing.keys].sort()).toEqual([
      'packagingWeightGrams',
      'shippingMarkupPercent',
    ])

    // Le message doit citer les deux : c'est lui qui est remonté jusqu'au
    // terminal, et un message qui n'en cite qu'un fait croire à un seul défaut.
    expect(missing.message).toContain('shippingMarkupPercent')
    expect(missing.message).toContain('packagingWeightGrams')
  })

  it('se listent sans lever, pour l’écran qui doit les afficher', async () => {
    // `findMissingSettings` sert précisément quand la configuration est en
    // défaut : lever y rendrait l'écran de réparation inaccessible, ce qui est
    // exactement le cul-de-sac qu'on vient de payer.
    await prisma.setting.delete({ where: { key: 'shippingMarkupPercent' } })

    const manquants = await findMissingSettings()
    expect(manquants).toContain('shippingMarkupPercent')
    expect(manquants).not.toContain('minMarginCents')
  })

  it('ne signale rien quand la base est complète', async () => {
    expect(await findMissingSettings()).toEqual([])
  })
})
