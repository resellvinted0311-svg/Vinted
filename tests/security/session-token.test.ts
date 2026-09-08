import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import {
  isValidShopSessionToken,
  shopSessionCookieName,
  SHOP_SESSION_MAX_AGE_SECONDS,
  SHOP_SESSION_TOKEN_MAX_LENGTH,
} from '@/lib/shop/session-token'
import { __resetServerSecretForTests } from '@/lib/security/secret'
import { GUEST_DATA_RETENTION_DAYS } from '@/lib/config/privacy'

/**
 * Le jeton de session boutique porte le panier, les favoris, et le
 * propriétaire du verrou de stock. Trois propriétés doivent tenir.
 */

const SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac'

let savedAuth: string | undefined

beforeEach(() => {
  savedAuth = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = SECRET
  __resetServerSecretForTests()
})

afterEach(() => {
  if (savedAuth === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = savedAuth

  // NODE_ENV est en lecture seule pour TypeScript : `stubEnv` est la seule
  // façon propre de le faire varier, et il se défait tout seul.
  vi.unstubAllEnvs()
  __resetServerSecretForTests()
})

/** Reproduit la frappe du serveur, pour disposer d'un jeton authentique. */
function mintLikeServer(): string {
  const payload = randomBytes(24).toString('base64url')
  const signature = createHmac('sha256', SECRET)
    .update(`shop-session ${payload}`)
    .digest('base64url')
    .slice(0, 22)
  return `${payload}.${signature}`
}

describe('validité du jeton', () => {
  it('accepte un jeton réellement émis par ce serveur', () => {
    expect(isValidShopSessionToken(mintLikeServer())).toBe(true)
  })

  it('refuse une valeur choisie par l’appelant', () => {
    // C'est le défaut corrigé : toute chaîne d'au moins 32 caractères était
    // adoptée telle quelle. Choisir le jeton d'autrui donnait accès à ses
    // favoris, et demain à son panier.
    expect(isValidShopSessionToken('a'.repeat(40))).toBe(false)
    expect(isValidShopSessionToken('a'.repeat(32))).toBe(false)
  })

  it('refuse un jeton dont la signature a été retouchée', () => {
    const token = mintLikeServer()
    const [payload, signature] = token.split('.') as [string, string]

    const altered = `${payload}.${signature.slice(0, -1)}${
      signature.endsWith('A') ? 'B' : 'A'
    }`
    expect(isValidShopSessionToken(altered)).toBe(false)
  })

  it('refuse un jeton signé avec un autre secret', () => {
    const token = mintLikeServer()

    process.env.AUTH_SECRET = 'un-tout-autre-secret-de-test-assez-long'
    __resetServerSecretForTests()

    expect(isValidShopSessionToken(token)).toBe(false)
  })

  it('refuse une charge démesurée, quelle que soit sa signature', () => {
    // L'index PostgreSQL refuse toute entrée au-delà de ~2704 octets : sans
    // borne, chaque mise en favori serait devenue une erreur 500.
    expect(isValidShopSessionToken(`${'a'.repeat(5000)}.court`)).toBe(false)
  })

  it('tient dans la colonne qui l’indexe', () => {
    const token = mintLikeServer()

    expect(token).toHaveLength(55)
    expect(token.length).toBeLessThanOrEqual(SHOP_SESSION_TOKEN_MAX_LENGTH)
  })
})

describe('cookie', () => {
  it('porte le préfixe __Host- en production', () => {
    // `__Host-` interdit l'attribut Domain : un sous-domaine ne peut donc plus
    // poser ce cookie sur le domaine parent. C'est la seconde serrure sur la
    // fixation, après la signature.
    vi.stubEnv('NODE_ENV', 'production')
    expect(shopSessionCookieName()).toBe('__Host-ND_SESSION')

    // Le préfixe est incompatible avec http://localhost, d'où les deux noms.
    vi.stubEnv('NODE_ENV', 'development')
    expect(shopSessionCookieName()).toBe('ND_SESSION')
  })

  it('ne fait pas survivre les données à leur cookie', () => {
    expect(SHOP_SESSION_MAX_AGE_SECONDS).toBe(
      GUEST_DATA_RETENTION_DAYS * 24 * 60 * 60,
    )
  })

  it('renouvelle le cookie quand le jeton est REPRIS, pas seulement créé', async () => {
    /**
     * La durée est GLISSANTE, et ce test est la seule chose qui l'empêche de
     * redevenir fixe.
     *
     * -------------------------------------------------------------------------
     * Le défaut, et pourquoi il était invisible
     * -------------------------------------------------------------------------
     * `ensureShopSessionToken` renvoyait le jeton existant sans réécrire son
     * cookie. Les trente jours couraient donc depuis la PREMIÈRE visite, quoi
     * qu'il arrive ensuite : quelqu'un qui revient au vingt-neuvième jour, met
     * deux pièces en favori et repasse le surlendemain les trouve disparues,
     * avec son panier.
     *
     * Il faut trente jours de calendrier pour que ce défaut se manifeste. Aucun
     * essai à la main ne le rencontre jamais, et il frappe précisément les
     * personnes qui reviennent.
     *
     * -------------------------------------------------------------------------
     * Ce que le test observe
     * -------------------------------------------------------------------------
     * Pas la durée — elle est déjà épinglée juste au-dessus — mais le fait que
     * `set` soit APPELÉE sur un jeton déjà valide. C'est l'écriture qui remet
     * le compteur à zéro ; sans elle, la valeur de `maxAge` ne sert à rien.
     *
     * La valeur renvoyée est vérifiée aussi : renouveler ne doit pas faire
     * tourner le jeton. Le faire viderait les favoris à chaque page, puisque
     * `GuestFavorite` est indexée dessus — ce serait remplacer une perte à
     * trente jours par une perte immédiate.
     */
    const jeton = mintLikeServer()

    /*
      Le magasin de cookies est simulé : `cookies()` de Next exige un contexte
      de requête, qui n'existe pas sous vitest. On n'en a besoin que de deux
      méthodes, et c'est justement l'appel à `set` qu'on veut observer.
    */
    const set = vi.fn()
    vi.doMock('next/headers', () => ({
      cookies: () =>
        Promise.resolve({
          get: (nom: string) =>
            nom === shopSessionCookieName()
              ? { name: nom, value: jeton }
              : undefined,
          set,
          delete: vi.fn(),
        }),
    }))

    vi.resetModules()
    const { ensureShopSessionToken } = await import('@/lib/shop/session-token')
    const rendu = await ensureShopSessionToken()

    expect(rendu, 'un jeton valide ne doit pas être remplacé').toBe(jeton)
    expect(
      set,
      'le cookie doit être réécrit, sinon les trente jours ne glissent pas',
    ).toHaveBeenCalled()

    const [, valeurEcrite, options] = set.mock.calls[0] as [
      string,
      string,
      { maxAge?: number },
    ]
    expect(valeurEcrite).toBe(jeton)
    expect(options.maxAge).toBe(SHOP_SESSION_MAX_AGE_SECONDS)

    vi.doUnmock('next/headers')
    vi.resetModules()
  })
})
