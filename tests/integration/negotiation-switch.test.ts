import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest'

/**
 * La négociation éteinte — et ce que l'interrupteur ne doit PAS casser.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier retire une variable que toute la suite pose
 * ---------------------------------------------------------------------------
 * `tests/setup-env.ts` allume la négociation pour toute la suite : la mécanique
 * existe, et les fichiers qui l'exercent doivent continuer de le faire. Mais en
 * production elle est ÉTEINTE par défaut, et c'est ce comportement-là que les
 * gens verront. Ce fichier est le seul à le tester, et il retire donc la
 * variable avant chaque cas.
 *
 * ---------------------------------------------------------------------------
 * Le cas le plus important n'est pas celui qu'on croit
 * ---------------------------------------------------------------------------
 * On pense d'abord au formulaire d'offre qui disparaît. Le vrai risque est
 * ailleurs : l'écran des réglages masque les huit réglages de négociation, et
 * l'action d'enregistrement EXIGE chaque champ de la liste qu'elle parcourt.
 * Si les deux ne lisaient pas la même liste, plus aucun enregistrement ne
 * passerait — et la boutique ne pourrait plus quitter le mode démonstration,
 * donc refuserait tous les imports depuis l'application de gestion.
 */

let admin = { id: '', email: 'admin@nina-diego.test', role: 'ADMIN' as const }

vi.mock('@/lib/auth/session', () => ({
  requireAdmin: async () => admin,
}))

const { prisma } = await import('@/lib/db/client')
const { __resetRateLimitForTests } = await import('@/lib/security/rate-limit')
const { isNegotiationEnabled } = await import('@/lib/config/site')
const { EDITABLE_SETTINGS, reglagesEditables } =
  await import('@/lib/config/settings')
const { updateSettingsAction } = await import('@/lib/admin/settings-actions')
const { submitOffer } = await import('@/lib/shop/offers')

const seededAdmin = await prisma.user.findUniqueOrThrow({
  where: { email: 'admin@nina-diego.test' },
  select: { id: true },
})
admin = { ...admin, id: seededAdmin.id }

const VARIABLE = 'OFFERS_ENABLED'
const valeurInitiale = process.env[VARIABLE]

/** Les réglages qu'un enregistrement peut toucher — pour les remettre après. */
const SURVEILLES = [
  ...EDITABLE_SETTINGS.map((setting) => setting.key),
  'settingsProfile',
]
let instantane: { key: string; value: unknown }[] = []

beforeEach(async () => {
  delete process.env[VARIABLE]
  __resetRateLimitForTests()

  if (instantane.length === 0) {
    instantane = await prisma.setting.findMany({
      where: { key: { in: SURVEILLES } },
      select: { key: true, value: true },
    })
  }
})

afterEach(async () => {
  // Remis exactement comme avant : les autres fichiers tournent contre la même
  // base, et une boutique laissée en `production` calculerait des prix sur les
  // chiffres du jeu de démonstration.
  for (const ligne of instantane) {
    await prisma.setting.update({
      where: { key: ligne.key },
      data: { value: ligne.value as never },
    })
  }
})

afterAll(async () => {
  if (valeurInitiale === undefined) delete process.env[VARIABLE]
  else process.env[VARIABLE] = valeurInitiale
  await prisma.$disconnect()
})

/** Le formulaire que l'écran enverrait, construit depuis la liste qu'il AFFICHE. */
async function formulaireAffiche(): Promise<FormData> {
  const champs = reglagesEditables()
  const lignes = await prisma.setting.findMany({
    where: { key: { in: champs.map((champ) => champ.key) } },
    select: { key: true, value: true },
  })
  const parCle = new Map(lignes.map((ligne) => [ligne.key, ligne.value]))

  const formulaire = new FormData()
  for (const champ of champs) {
    const valeur = parCle.get(champ.key)

    // Une case décochée n'est pas envoyée par un navigateur.
    if (champ.kind === 'boolean') {
      if (valeur === true) formulaire.set(champ.key, 'on')
      continue
    }

    if (champ.kind === 'dropSchedule') {
      const paliers = Array.isArray(valeur) ? valeur : []
      formulaire.set(
        champ.key,
        paliers
          .map((p) => {
            const palier = p as { days: number; percent: number }
            return `${palier.days}:${palier.percent}`
          })
          .join('\n'),
      )
      continue
    }

    formulaire.set(
      champ.key,
      valeur === null || valeur === undefined ? '' : String(valeur),
    )
  }
  return formulaire
}

describe('l’interrupteur', () => {
  it('est éteint par défaut, et ne s’allume que sur « 1 »', () => {
    // Éteint par défaut : c'est la décision de la boutique, et une variable
    // oubliée ne doit pas se traduire par une négociation ouverte.
    expect(isNegotiationEnabled()).toBe(false)

    process.env[VARIABLE] = '0'
    expect(isNegotiationEnabled()).toBe(false)

    process.env[VARIABLE] = 'true'
    // Délibérément strict : « true », « oui », « on » ne l'allument pas. Une
    // seule valeur, documentée, plutôt qu'une liste qu'on devinerait.
    expect(isNegotiationEnabled()).toBe(false)

    process.env[VARIABLE] = ' 1 '
    // Un espace collé dans l'interface de l'hébergeur ne doit pas suffire à
    // laisser la fonction éteinte quand on a voulu l'allumer.
    expect(isNegotiationEnabled()).toBe(true)
  })
})

describe('éteinte, la négociation', () => {
  it('refuse tout dépôt d’offre CÔTÉ SERVEUR, sans rien écrire', async () => {
    /*
      Le formulaire disparaît des fiches, mais un formulaire masqué n'est pas
      une protection : une Server Action est un POST que n'importe qui peut
      former. Le refus doit vivre dans le chemin que tout dépôt emprunte.
    */
    const piece = await prisma.article.findFirstOrThrow({
      where: { status: 'AVAILABLE' },
      select: { id: true },
    })
    const avant = await prisma.offer.count({ where: { articleId: piece.id } })

    const resultat = await submitOffer({
      articleId: piece.id,
      amountCents: 100,
      owner: { userId: null, sessionToken: 'jeton-essai', email: 'a@b.test' },
    })

    expect(resultat).toEqual({ ok: false, rejection: 'offers-disabled' })
    expect(await prisma.offer.count({ where: { articleId: piece.id } })).toBe(
      avant,
    )
  })

  it('retire ses huit réglages de l’écran, et seulement eux', () => {
    const affiches = reglagesEditables()
    const masques = EDITABLE_SETTINGS.filter((s) => !affiches.includes(s))

    expect(masques.length).toBe(8)
    expect(masques.every((s) => s.group === 'offers')).toBe(true)
    // Le barème de baisse automatique n'est PAS de la négociation : il baisse
    // un prix affiché, il ne répond à personne. Il reste.
    expect(affiches.some((s) => s.key === 'autoDropSchedule')).toBe(true)
  })

  it('laisse ENREGISTRER les réglages sans ses champs — le cas qui compte', async () => {
    /*
      Si l'action réclamait encore les huit champs que la page ne montre plus,
      chaque enregistrement échouerait en « requête incomplète », et la
      boutique resterait bloquée en mode démonstration.
    */
    await prisma.setting.update({
      where: { key: 'settingsProfile' },
      data: { value: 'development' },
    })

    const etat = await updateSettingsAction(
      { status: 'idle' },
      await formulaireAffiche(),
    )

    expect(etat.status).toBe('done')

    // L'enregistrement fait bien sortir du mode démonstration.
    const profil = await prisma.setting.findUniqueOrThrow({
      where: { key: 'settingsProfile' },
      select: { value: true },
    })
    expect(profil.value).toBe('production')
  })

  it('ne touche pas aux valeurs des réglages masqués', async () => {
    // Ils réapparaissent tels quels le jour où la négociation est rallumée.
    // Un enregistrement qui les remettrait à zéro faute de les avoir reçus
    // ferait perdre une configuration qu'on avait réglée.
    const cles = EDITABLE_SETTINGS.filter((s) => s.group === 'offers').map(
      (s) => s.key,
    )
    const avant = await prisma.setting.findMany({
      where: { key: { in: cles } },
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
    })

    await updateSettingsAction({ status: 'idle' }, await formulaireAffiche())

    const apres = await prisma.setting.findMany({
      where: { key: { in: cles } },
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
    })
    expect(apres).toEqual(avant)
  })
})

describe('allumée, la négociation', () => {
  it('rend ses huit réglages à l’écran', () => {
    process.env[VARIABLE] = '1'
    expect(reglagesEditables()).toHaveLength(EDITABLE_SETTINGS.length)
  })
})
