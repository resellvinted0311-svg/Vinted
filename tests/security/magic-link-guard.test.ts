import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * La CSRF de connexion par lien magique.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces tests protègent
 * ---------------------------------------------------------------------------
 * Le rappel d'un lien magique est un GET, et un GET s'exécute sans que
 * personne l'ait voulu : il suffit d'une image dont la source est cette
 * adresse. Quelqu'un demandait un lien pour SA PROPRE adresse, l'amenait
 * devant une victime, et le navigateur de celle-ci se retrouvait authentifié
 * sur le compte de l'attaquant — puis son adresse postale et son téléphone
 * atterrissaient sur une commande qui ne lui appartenait pas.
 *
 * Le défaut était connu et daté dans `lib/auth/index.ts` : « À RÉGLER AVEC LE
 * TUNNEL DE COMMANDE — ne pas brancher le paiement sans ». Le tunnel a été
 * branché avant le correctif.
 *
 * Trois propriétés font tenir la protection, et chacune a son test :
 *   1. le rappel exige une preuve, qu'un GET direct n'a pas ;
 *   2. la preuve est liée AU JETON, donc ne se recycle pas d'un lien à l'autre ;
 *   3. l'adresse de confirmation n'est pas une redirection ouverte.
 */

const SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac-de-lien'
process.env.AUTH_SECRET = SECRET
process.env.NEXT_PUBLIC_SITE_URL = 'https://boutique.test'

/**
 * Boîte à cookies en mémoire, à la place de celle de la requête.
 *
 * Les OPTIONS sont retenues à part : ce sont elles qui portent `httpOnly` et
 * `sameSite`, et un cookie de confirmation lisible par un script annulerait
 * tout le dispositif — dont l'objet est précisément de résister à ce qui
 * s'exécute dans la page.
 */
const jar = new Map<string, string>()
const setOptions: Record<string, unknown>[] = []

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.set(name, value)
      setOptions.push(options ?? {})
    },
    delete: (name: string) => {
      jar.delete(name)
    },
  }),
}))

const {
  clearConfirmation,
  confirmationPageUrl,
  hasConfirmation,
  isMagicCallbackUrl,
  tokenFromCallback,
  writeConfirmation,
} = await import('@/lib/auth/magic-link-guard')

const { __resetServerSecretForTests } = await import('@/lib/security/secret')

const CALLBACK =
  'https://boutique.test/api/auth/callback/magic-link' +
  '?callbackUrl=%2Ffr%2Fcompte&token=jeton-de-connexion&email=personne%40exemple.fr'

beforeEach(() => {
  jar.clear()
  setOptions.length = 0
  __resetServerSecretForTests()
})

// ---------------------------------------------------------------------------
// La preuve
// ---------------------------------------------------------------------------

describe('preuve de confirmation', () => {
  it('manque tant que personne n’a confirmé', async () => {
    // LE cas d'attaque : le rappel arrive sans qu'aucun geste ne l'ait
    // précédé, parce qu'une image l'a chargé.
    expect(await hasConfirmation('jeton-de-connexion')).toBe(false)
  })

  it('vaut après confirmation, pour CE jeton', async () => {
    await writeConfirmation('jeton-de-connexion')
    expect(await hasConfirmation('jeton-de-connexion')).toBe(true)
  })

  it('ne vaut pas pour un AUTRE jeton', async () => {
    // Sans ce lien au jeton, un simple drapeau « j'ai confirmé » se
    // recyclerait : la victime confirme sa propre connexion, l'attaquant lui
    // présente ensuite son lien à lui, et le cookie encore vivant le laisse
    // passer.
    await writeConfirmation('mon-jeton')
    expect(await hasConfirmation('le-jeton-de-quelqu-un-dautre')).toBe(false)
  })

  it('ne survit pas à son usage', async () => {
    // Un jeton de lien magique est à usage unique ; sa preuve doit l'être.
    await writeConfirmation('jeton-de-connexion')
    await clearConfirmation()
    expect(await hasConfirmation('jeton-de-connexion')).toBe(false)
  })

  it('ne se devine pas depuis le jeton seul', async () => {
    // La preuve est un HMAC : sans le secret du serveur, la connaître exige de
    // la voler, pas de la calculer.
    await writeConfirmation('jeton-de-connexion')
    const stored = [...jar.values()][0] ?? ''
    expect(stored).not.toContain('jeton-de-connexion')
    expect(stored.length).toBeGreaterThan(20)
  })

  it('pose un cookie httpOnly, borné dans le temps', async () => {
    await writeConfirmation('jeton-de-connexion')

    expect(setOptions[0]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    // Le laissez-passer d'un geste vers le suivant, pas la durée du jeton :
    // l'élargir à quinze minutes ouvrirait la fenêtre sans rien apporter.
    expect(setOptions[0]?.maxAge).toBeLessThanOrEqual(15 * 60)
  })
})

// ---------------------------------------------------------------------------
// L'adresse de rappel
// ---------------------------------------------------------------------------

describe('validation de l’adresse de rappel', () => {
  it('accepte le rappel authentique', () => {
    expect(isMagicCallbackUrl(CALLBACK)).toBe(true)
    expect(tokenFromCallback(new URL(CALLBACK))).toBe('jeton-de-connexion')
  })

  it('refuse une autre origine', () => {
    // Sans ce contrôle, le paramètre de la page de confirmation deviendrait
    // une redirection ouverte signée par notre domaine — un tremplin idéal
    // pour un hameçonnage.
    expect(
      isMagicCallbackUrl(
        'https://boutique.test.attaquant.fr/api/auth/callback/magic-link?token=x',
      ),
    ).toBe(false)
    expect(
      isMagicCallbackUrl('https://attaquant.fr/api/auth/callback/magic-link?token=x'),
    ).toBe(false)
  })

  it('refuse un autre chemin de la même origine', () => {
    expect(isMagicCallbackUrl('https://boutique.test/fr/compte?token=x')).toBe(false)
    expect(
      isMagicCallbackUrl('https://boutique.test/api/auth/signout?token=x'),
    ).toBe(false)
  })

  it('refuse un rappel sans jeton', () => {
    expect(
      isMagicCallbackUrl('https://boutique.test/api/auth/callback/magic-link'),
    ).toBe(false)
  })

  it('refuse ce qui n’est pas une adresse', () => {
    for (const bad of ['', 'javascript:alert(1)', '/fr/compte', 'null']) {
      expect(isMagicCallbackUrl(bad), bad).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Ce que l'e-mail transporte
// ---------------------------------------------------------------------------

describe('adresse mise dans l’e-mail', () => {
  it('mène à la page de confirmation, pas au rappel', async () => {
    // C'est ce qui rend le dispositif praticable : le lien reçu ne DÉCLENCHE
    // rien, il ouvre un écran.
    const url = new URL(confirmationPageUrl(CALLBACK, 'fr'))

    expect(url.origin).toBe('https://boutique.test')
    expect(url.pathname).toBe('/fr/connexion/lien')
    expect(url.searchParams.get('suite')).toBe(CALLBACK)
  })

  it('respecte la langue de la demande', () => {
    const url = new URL(confirmationPageUrl(CALLBACK, 'nl'))
    expect(url.pathname).toBe('/nl/connexion/lien')
  })
})
