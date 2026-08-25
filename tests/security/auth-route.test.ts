import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Les gardes de la route Auth.js — sur la ROUTE, pas sur le verbe.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier existe en plus de `magic-link-guard.test.ts`
 * ---------------------------------------------------------------------------
 * L'autre exerce le MODULE de garde : la preuve, sa liaison au jeton, son usage
 * unique. Tous ses tests étaient verts pendant que la route, elle, laissait
 * passer — parce que la garde était posée dans le gestionnaire `GET`, et que le
 * chemin d'attaque passait par `POST`.
 *
 * C'est la leçon que ce fichier fige : une garde vérifiée sur son module ne dit
 * RIEN de la route qui l'appelle. Ce qui suit appelle les vrais gestionnaires
 * exportés, et vérifie ce qui atteint — ou n'atteint pas — `@auth/core`.
 *
 * ---------------------------------------------------------------------------
 * Les deux défauts trouvés par audit, et ce qu'ils permettaient
 * ---------------------------------------------------------------------------
 * 1. `@auth/core` traite `callback` en POST, et n'exige un jeton anti-CSRF que
 *    pour les fournisseurs `credentials`. Le lien magique est de type `email` :
 *    un POST vers `/api/auth/callback/magic-link?token=…&email=…` atteignait
 *    donc le cœur sans preuve de confirmation ET sans anti-CSRF. Un formulaire
 *    auto-soumis depuis un site tiers connectait la victime au compte de
 *    l'attaquant.
 *
 * 2. Le compteur par adresse lisait le corps avec `formData()`, qui LÈVE sur
 *    `application/json` — et le `catch` laissait passer. `@auth/core`, lui,
 *    accepte le JSON. Changer un en-tête suffisait à envoyer sans limite.
 */

process.env.AUTH_SECRET = 'secret-de-test-suffisamment-long-pour-un-hmac-de-lien'
process.env.NEXT_PUBLIC_SITE_URL = 'https://boutique.test'

/** Ce qui a réellement atteint `@auth/core`. */
const reached: { method: string; url: string }[] = []

vi.mock('@/lib/auth', () => ({
  handlers: {
    GET: async (request: Request) => {
      reached.push({ method: 'GET', url: request.url })
      return new Response('coeur-atteint', { status: 200 })
    },
    POST: async (request: Request) => {
      reached.push({ method: 'POST', url: request.url })
      return new Response('coeur-atteint', { status: 200 })
    },
  },
}))

/** Compteurs observés, pour vérifier lesquels sont réellement consultés. */
const counted: string[] = []
let allowNext = true

vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: async ({ key }: { key: string }) => {
    counted.push(key)
    return allowNext
  },
}))

vi.mock('@/lib/security/fingerprint', () => ({
  clientFingerprint: async () => 'empreinte-de-test',
}))

let confirmed = false
vi.mock('@/lib/auth/magic-link-guard', async () => {
  const real = await vi.importActual<
    typeof import('@/lib/auth/magic-link-guard')
  >('@/lib/auth/magic-link-guard')
  return {
    ...real,
    hasConfirmation: async () => confirmed,
    clearConfirmation: async () => undefined,
  }
})

const ROUTE = await import('@/app/api/auth/[...nextauth]/route')

const CALLBACK =
  'https://boutique.test/api/auth/callback/magic-link?token=jeton-vole&email=attaquant%40exemple.fr'

function params(...segments: string[]) {
  return { params: Promise.resolve({ nextauth: segments }) }
}

beforeEach(() => {
  reached.length = 0
  counted.length = 0
  allowNext = true
  confirmed = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('rappel du lien magique', () => {
  it('N’ACCEPTE PAS le POST — c’était la CSRF de connexion', async () => {
    // Le cœur d'`@auth/core` lit le jeton dans la chaîne de requête et ne
    // valide aucun anti-CSRF pour un fournisseur `email`. Si la requête
    // l'atteint, la session s'ouvre.
    const response = await ROUTE.POST(
      new NextRequest(CALLBACK, { method: 'POST' }) as never,
      params('callback', 'magic-link'),
    )

    expect(reached, 'rien ne doit atteindre @auth/core').toEqual([])
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('lien-non-confirme')
  })

  it('refuse le GET sans preuve de confirmation', async () => {
    const response = await ROUTE.GET(
      new NextRequest(CALLBACK) as never,
      params('callback', 'magic-link'),
    )

    expect(reached).toEqual([])
    expect(response.status).toBe(303)
  })

  it('laisse passer le GET une fois la confirmation posée', async () => {
    // Le parcours légitime : un clic sur le lien, puis le bouton de la page de
    // confirmation. Sans ce test, refuser TOUT rendrait la suite verte pour la
    // pire des raisons — plus personne ne peut se connecter.
    confirmed = true

    await ROUTE.GET(new NextRequest(CALLBACK) as never, params('callback', 'magic-link'))

    expect(reached).toHaveLength(1)
    expect(reached[0]!.method).toBe('GET')
  })
})

describe('compteur d’envoi du lien magique', () => {
  const SIGNIN = 'https://boutique.test/api/auth/signin/magic-link'

  it('compte l’adresse portée par un corps de FORMULAIRE', async () => {
    const body = new URLSearchParams({ email: 'Cible@Exemple.fr' })
    await ROUTE.POST(
      new NextRequest(SIGNIN, { method: 'POST', body }) as never,
      params('signin', 'magic-link'),
    )

    expect(counted.some((key) => key.startsWith('magic:'))).toBe(true)
    expect(counted.some((key) => key.startsWith('magic-mail:'))).toBe(true)
    expect(reached).toHaveLength(1)
  })

  it('compte AUSSI l’adresse portée par un corps JSON', async () => {
    // Le contournement réparé : `formData()` lève sur un corps JSON, et le
    // `catch` laissait passer. `@auth/core`, lui, accepte le JSON — il
    // suffisait donc de changer l'en-tête pour envoyer sans limite.
    await ROUTE.POST(
      new NextRequest(SIGNIN, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'cible@exemple.fr' }),
      }) as never,
      params('signin', 'magic-link'),
    )

    expect(
      counted.some((key) => key.startsWith('magic-mail:')),
      'le compteur par adresse doit s’appliquer quel que soit l’encodage',
    ).toBe(true)
  })

  it('donne la MÊME clé pour la même adresse, quel que soit l’encodage', async () => {
    // Sinon le contournement subsiste sous une autre forme : deux encodages,
    // deux seaux, donc deux fois le plafond.
    await ROUTE.POST(
      new NextRequest(SIGNIN, {
        method: 'POST',
        body: new URLSearchParams({ email: 'cible@exemple.fr' }),
      }) as never,
      params('signin', 'magic-link'),
    )
    const viaForm = counted.find((key) => key.startsWith('magic-mail:'))

    counted.length = 0
    await ROUTE.POST(
      new NextRequest(SIGNIN, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'CIBLE@exemple.fr' }),
      }) as never,
      params('signin', 'magic-link'),
    )
    const viaJson = counted.find((key) => key.startsWith('magic-mail:'))

    expect(viaJson).toBe(viaForm)
  })

  it('REFUSE un corps illisible au lieu de le laisser passer', async () => {
    // C'était l'inverse. Le refus ne coûte rien de légitime : sans adresse
    // exploitable, `@auth/core` n'a de toute façon aucun message à envoyer.
    const response = await ROUTE.POST(
      new NextRequest(SIGNIN, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'ceci-n-est-pas-du-json',
      }) as never,
      params('signin', 'magic-link'),
    )

    expect(reached).toEqual([])
    expect(response.status).toBe(303)
  })

  it('répond comme un envoi réussi quand le plafond est atteint', async () => {
    // Dire « trop de tentatives » rétablirait l'oracle que le formulaire ferme :
    // on saurait qu'une adresse vient d'être sollicitée.
    allowNext = false

    const response = await ROUTE.POST(
      new NextRequest(SIGNIN, {
        method: 'POST',
        body: new URLSearchParams({ email: 'cible@exemple.fr' }),
      }) as never,
      params('signin', 'magic-link'),
    )

    expect(reached).toEqual([])
    expect(response.headers.get('location')).toContain('lien=envoye')
  })
})

describe('les autres routes ne sont pas gênées', () => {
  it('laisse passer la déconnexion', async () => {
    await ROUTE.POST(
      new NextRequest('https://boutique.test/api/auth/signout', {
        method: 'POST',
      }) as never,
      params('signout'),
    )

    expect(reached).toHaveLength(1)
  })

  it('laisse passer le rappel d’un AUTRE fournisseur', async () => {
    // La garde vise le lien magique nommément. Un fournisseur `credentials`,
    // lui, est déjà couvert par le jeton anti-CSRF d'`@auth/core`.
    await ROUTE.POST(
      new NextRequest('https://boutique.test/api/auth/callback/credentials', {
        method: 'POST',
      }) as never,
      params('callback', 'credentials'),
    )

    expect(reached).toHaveLength(1)
  })
})

/**
 * Le compteur d'échecs par COMPTE, toutes origines confondues.
 *
 * Les deux compteurs historiques de la connexion portent l'empreinte de
 * l'appelant, qui dérive de l'adresse IP : chaque IP ouvrait deux seaux neufs.
 * Rien ne comptait les essais dirigés contre un compte précis depuis mille
 * origines — un parc de sorties donnait 40 000 essais par heure sur une adresse
 * ciblée.
 */
describe('connexion par mot de passe', () => {
  it('les trois compteurs sont posés, dont un SANS empreinte', async () => {
    const source = readFileSync(
      join(process.cwd(), 'lib', 'auth', 'actions.ts'),
      'utf8',
    )

    // Les deux historiques portent l'empreinte…
    expect(source).toContain('`signin:${fingerprint}:${account}`')
    expect(source).toContain('`signin-origin:${fingerprint}`')

    // …et le troisième, non : c'est tout l'objet du correctif. S'il portait
    // l'empreinte, il rouvrirait exactement la porte qu'il ferme.
    expect(source).toContain('`signin-account:${account}`')
    expect(source).not.toContain('signin-account:${fingerprint}')
  })

  it('le refus par ce compteur est INDISCERNABLE d’un mot de passe faux', async () => {
    // Répondre « trop de tentatives » ferait du compteur un oracle : on
    // saurait que ce compte existe, et on verrait le verrouillage opérer.
    const source = readFileSync(
      join(process.cwd(), 'lib', 'auth', 'actions.ts'),
      'utf8',
    )
    const bloc = source.slice(
      source.indexOf('const accountKey'),
      source.indexOf('const user = await prisma.user.findUnique'),
    )

    expect(bloc).toContain("messageKey: 'invalidCredentials'")
    expect(bloc).not.toContain("messageKey: 'rateLimited'")
  })

  it('une connexion réussie REMET le compteur à zéro', async () => {
    // Sans cela, il compterait les tentatives et non les échecs consécutifs, et
    // finirait par refuser quelqu'un qui n'a rien fait de mal.
    const source = readFileSync(
      join(process.cwd(), 'lib', 'auth', 'actions.ts'),
      'utf8',
    )
    const apresVerification = source.slice(
      source.indexOf("messageKey: 'invalidCredentials'"),
    )
    expect(apresVerification).toContain('clearRateLimit(accountKey)')
  })
})
