import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

/**
 * L'action serveur qui enregistre les réglages métier.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle mérite ses propres tests, en plus de ceux de `writeSettings`
 * ---------------------------------------------------------------------------
 * `writeSettings` valide et écrit. L'action, elle, fait trois choses de plus,
 * et chacune peut se rater silencieusement :
 *
 *  - elle LIT le formulaire par la liste fermée, jamais en bouclant sur ce qui
 *    a été envoyé. Un champ ajouté par un appelant ne doit pas exister pour
 *    elle ;
 *  - elle fait passer `settingsProfile` à `production`, ce qui LÈVE le refus de
 *    `getPricingConfig()`. Oublier cette bascule laisserait la boutique refuser
 *    de vendre alors que tout est réglé ;
 *  - elle consigne à la piste d'audit une entrée par réglage RÉELLEMENT
 *    modifié, et sans aucune valeur.
 *
 * Aucune de ces trois-là n'est visible depuis `writeSettings`.
 */

/**
 * L'administrateur est le compte RÉELLEMENT semé, pas un identifiant inventé.
 *
 * `AuditLog.actorId` porte une clé étrangère vers `User` : consigner au nom
 * d'un identifiant qui n'existe pas échoue à l'écriture. C'est une bonne
 * contrainte — elle interdit une piste d'audit qui désignerait des auteurs
 * introuvables — et elle vaut aussi pour les tests.
 */
let admin = { id: '', email: 'admin@nina-diego.test', role: 'ADMIN' as const }

const requireAdminMock = vi.fn(async () => admin)

vi.mock('@/lib/auth/session', () => ({
  requireAdmin: () => requireAdminMock(),
}))

const { prisma } = await import('@/lib/db/client')
const { __resetRateLimitForTests } = await import('@/lib/security/rate-limit')
const { updateSettingsAction } = await import('@/lib/admin/settings-actions')
const { EDITABLE_SETTINGS, getSettings } = await import('@/lib/config/settings')

const seededAdmin = await prisma.user.findUniqueOrThrow({
  where: { email: 'admin@nina-diego.test' },
  select: { id: true },
})
admin = { ...admin, id: seededAdmin.id }

const WATCHED = [
  ...EDITABLE_SETTINGS.map((setting) => setting.key),
  'settingsProfile',
] as const

let original: { key: string; value: unknown }[] = []

/** Le formulaire complet, tel que l'écran l'envoie, avant modification. */
async function currentForm(): Promise<FormData> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: EDITABLE_SETTINGS.map((s) => s.key) } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((row) => [row.key, row.value]))

  const form = new FormData()
  for (const setting of EDITABLE_SETTINGS) {
    const value = byKey.get(setting.key)

    if (setting.kind === 'boolean') {
      // Une case décochée n'est pas envoyée : on reproduit ce comportement,
      // sinon le test exercerait un formulaire que le navigateur n'enverrait
      // jamais.
      if (value === true) form.set(setting.key, 'on')
      continue
    }

    if (setting.kind === 'dropSchedule') {
      const stages = Array.isArray(value) ? value : []
      form.set(
        setting.key,
        stages
          .map((stage) => `${(stage as { days: number }).days}:${(stage as { percent: number }).percent}`)
          .join('\n'),
      )
      continue
    }

    form.set(setting.key, value === null || value === undefined ? '' : String(value))
  }

  return form
}

beforeEach(async () => {
  if (original.length === 0) {
    original = await prisma.setting.findMany({
      where: { key: { in: [...WATCHED] } },
      select: { key: true, value: true },
    })
  }

  /**
   * `upsert` : un test de ce fichier SUPPRIME `settingsProfile` pour reproduire
   * une base plus ancienne que le code. Restaurer par `update` échouerait alors
   * sur une ligne absente, et emporterait tous les tests suivants avec lui —
   * l'échec désignerait le mauvais coupable.
   */
  for (const row of original) {
    await prisma.setting.upsert({
      where: { key: row.key },
      update: { value: row.value as never },
      create: { key: row.key, value: row.value as never },
    })
  }

  await prisma.auditLog.deleteMany({ where: { actorId: admin.id } })
  requireAdminMock.mockClear()
  requireAdminMock.mockImplementation(async () => admin)
  __resetRateLimitForTests()
})

afterAll(async () => {
  for (const row of original) {
    await prisma.setting.upsert({
      where: { key: row.key },
      update: { value: row.value as never },
      create: { key: row.key, value: row.value as never },
    })
  }
  await prisma.auditLog.deleteMany({ where: { actorId: admin.id } })
  await prisma.$disconnect()
})

describe('le contrôle du rôle', () => {
  it('passe AVANT toute lecture de l’entrée', async () => {
    // Une Server Action est appelée par un POST vers l'URL de la page qui l'a
    // rendue : rien n'oblige un appelant à passer par cette page, et le
    // middleware ne la voit pas. Sans ce contrôle, poser la marge minimale à
    // zéro puis acheter tout le catalogue au prix de revient ne demanderait
    // qu'une requête.
    requireAdminMock.mockImplementation(async () => {
      throw new Error('Accès réservé à l’administration.')
    })

    const form = new FormData()
    form.set('minMarginCents', '1')

    await expect(
      updateSettingsAction({ status: 'idle' }, form),
    ).rejects.toThrow('Accès réservé')

    // Et rien n'a été écrit.
    const after = await getSettings(['minMarginCents'])
    expect(after.minMarginCents).toBe(
      (original.find((row) => row.key === 'minMarginCents')?.value as number),
    )
  })
})

describe('l’enregistrement', () => {
  it('écrit la valeur modifiée et laisse les autres en place', async () => {
    const before = await getSettings(['minMarginCents', 'shippingMarkupPercent'])

    const form = await currentForm()
    form.set('minMarginCents', '842')

    const state = await updateSettingsAction({ status: 'idle' }, form)
    expect(state).toEqual({ status: 'done', changed: 1 })

    const after = await getSettings(['minMarginCents', 'shippingMarkupPercent'])
    expect(after.minMarginCents).toBe(842)
    expect(after.shippingMarkupPercent).toBe(before.shippingMarkupPercent)
  })

  it('fait passer le profil en « production », sans case à cocher', async () => {
    await prisma.setting.update({
      where: { key: 'settingsProfile' },
      data: { value: 'development' },
    })

    const form = await currentForm()
    form.set('minMarginCents', '777')
    await updateSettingsAction({ status: 'idle' }, form)

    // La bascule est une CONSÉQUENCE d'avoir enregistré. Une case à cocher
    // aurait deux défauts : on peut cocher sans avoir rien saisi, et on peut
    // saisir sans penser à cocher — le second laissant la boutique refuser de
    // vendre alors que tout est réglé.
    const profile = await prisma.setting.findUniqueOrThrow({
      where: { key: 'settingsProfile' },
      select: { value: true },
    })
    expect(profile.value).toBe('production')
  })

  it('bascule le profil même si la LIGNE n’existe pas encore', async () => {
    /**
     * Le cas réel, et non un cas de laboratoire.
     *
     * La base de production avait été semée AVANT que `settingsProfile`
     * n'existe dans le code. La ligne était donc absente, `update` levait
     * P2025, la transaction entière était annulée — et l'écran répondait par
     * une erreur sans rien enregistrer.
     *
     * Conséquence exacte, celle qu'on ne veut plus jamais revoir : la boutique
     * restait sur ses chiffres de démonstration, `getPricingConfig()`
     * continuait de refuser, l'import d'inventaire répondait 503 « boutique non
     * configurée » — et le seul écran prévu pour en sortir était précisément
     * celui qui échouait. Un cul-de-sac.
     */
    await prisma.setting.delete({ where: { key: 'settingsProfile' } })

    const form = await currentForm()
    form.set('minMarginCents', '654')

    const state = await updateSettingsAction({ status: 'idle' }, form)
    expect(state).toEqual({ status: 'done', changed: 1 })

    const profile = await prisma.setting.findUniqueOrThrow({
      where: { key: 'settingsProfile' },
      select: { value: true },
    })
    expect(profile.value).toBe('production')

    // Et la valeur saisie est bien là : la bascule et l'écriture sont dans la
    // même transaction, donc l'une sans l'autre serait un demi-enregistrement.
    const after = await getSettings(['minMarginCents'])
    expect(after.minMarginCents).toBe(654)
  })

  it('IGNORE un champ qui ne figure pas dans la liste fermée', async () => {
    const before = await getSettings(['withdrawalPeriodDays'])

    const form = await currentForm()
    // Le délai légal de rétractation. Il existe en base, il a un schéma, il se
    // lit — mais il ne s'édite pas ici. L'action lit par la liste fermée : ce
    // champ n'existe tout simplement pas pour elle.
    form.set('withdrawalPeriodDays', '3')

    const state = await updateSettingsAction({ status: 'idle' }, form)
    expect(state).toEqual({ status: 'done', changed: 0 })

    const after = await getSettings(['withdrawalPeriodDays'])
    expect(after).toEqual(before)
  })

  it('refuse un lot entier pour une seule valeur illisible', async () => {
    const before = await getSettings(['minMarginCents', 'shippingMarkupPercent'])

    const form = await currentForm()
    form.set('shippingMarkupPercent', '12')
    form.set('minMarginCents', 'beaucoup')

    const state = await updateSettingsAction({ status: 'idle' }, form)
    expect(state).toMatchObject({
      status: 'error',
      messageKey: 'invalidValue',
      key: 'minMarginCents',
    })

    // La majoration était valide et n'a pas été écrite : sans cela, on
    // repartirait avec une configuration mixte que personne n'a choisie.
    const after = await getSettings(['minMarginCents', 'shippingMarkupPercent'])
    expect(after).toEqual(before)
  })

  it('refuse un formulaire amputé plutôt que d’inventer une valeur', async () => {
    const form = await currentForm()
    form.delete('minMarginCents')

    const state = await updateSettingsAction({ status: 'idle' }, form)
    expect(state).toMatchObject({ status: 'error', messageKey: 'invalidRequest' })
  })
})

describe('la piste d’audit', () => {
  it('consigne une entrée par réglage MODIFIÉ, et aucune pour les autres', async () => {
    const form = await currentForm()
    form.set('minMarginCents', '911')
    form.set('shippingMarkupPercent', '33')

    await updateSettingsAction({ status: 'idle' }, form)

    const entries = await prisma.auditLog.findMany({
      where: { actorId: admin.id, action: 'settings.updated' },
      select: { entity: true, entityId: true, before: true, after: true },
    })

    // Deux, pas seize : le formulaire renvoie TOUS les champs à chaque
    // enregistrement, et consigner les quatorze inchangés rendrait la piste
    // illisible au bout d'un mois.
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.entityId).sort()).toEqual([
      'minMarginCents',
      'shippingMarkupPercent',
    ])
    expect(entries.every((entry) => entry.entity === 'Setting')).toBe(true)
  })

  it('ne consigne AUCUNE valeur, ni avant ni après', async () => {
    const form = await currentForm()
    form.set('minMarginCents', '4242')

    await updateSettingsAction({ status: 'idle' }, form)

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { actorId: admin.id, action: 'settings.updated' },
      select: { before: true, after: true },
    })

    // Le point du test : `AuditLog` est conservée dix ans. Y recopier les
    // montants dupliquerait exactement ce qu'on vient de sortir du dépôt, dans
    // une table que personne ne relit et que la purge ne filtre pas.
    expect(entry.before).toBeNull()
    expect(entry.after).toBeNull()
    expect(JSON.stringify(entry)).not.toContain('4242')
  })

  it('ne consigne rien quand rien n’a changé', async () => {
    const form = await currentForm()

    const state = await updateSettingsAction({ status: 'idle' }, form)
    expect(state).toEqual({ status: 'done', changed: 0 })

    const count = await prisma.auditLog.count({
      where: { actorId: admin.id, action: 'settings.updated' },
    })
    expect(count).toBe(0)
  })
})
