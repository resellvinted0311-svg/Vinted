import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  captureException,
  sentryEnabled,
  __resetSentryForTests,
} from '@/lib/observability/sentry'

/**
 * Ce que la remontée d'incidents envoie réellement chez un tiers.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce test est un test de SÉCURITÉ
 * ---------------------------------------------------------------------------
 * Sentry est un sous-traitant au sens de l'article 28 : ce qui lui est envoyé
 * sort du périmètre du site. `activeProcessors()` le déclare dès que
 * `SENTRY_DSN` est posée — la déclaration publique dit donc qu'il traite des
 * données. Ce fichier vérifie CE qu'il reçoit, et surtout ce qu'il ne reçoit
 * pas.
 *
 * Le paquet officiel `@sentry/nextjs` capture tout seul l'URL de la requête,
 * ses en-têtes et parfois son corps. Sur cette boutique, l'URL suffit à
 * identifier quelqu'un — la page de retour de paiement porte l'identifiant de
 * session Stripe. C'est la raison pour laquelle l'enveloppe est composée à la
 * main ici : rien ne part qu'on n'ait mis soi-même.
 */

const DSN = 'https://cle-publique@o42.ingest.sentry.io/1337'

/** Le corps d'enveloppe réellement transmis, analysé ligne par ligne. */
function parseEnvelope(body: string): {
  header: Record<string, unknown>
  itemHeader: Record<string, unknown>
  payload: Record<string, unknown>
} {
  const [header, itemHeader, payload] = body.split('\n')
  return {
    header: JSON.parse(header!),
    itemHeader: JSON.parse(itemHeader!),
    payload: JSON.parse(payload!),
  }
}

let sent: { url: string; init: RequestInit }[]

beforeEach(() => {
  sent = []
  __resetSentryForTests()
  process.env.SENTRY_DSN = DSN

  // Le journal part sur la console à chaque appel : on le tait pour lire la
  // sortie du test, pas pour l'empêcher.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return new Response('', { status: 200 })
  })
})

afterEach(() => {
  delete process.env.SENTRY_DSN
  __resetSentryForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('branchement', () => {
  it('reste inerte sans DSN, et ne lève pas', async () => {
    delete process.env.SENTRY_DSN
    __resetSentryForTests()

    // C'est l'état par défaut du projet, et c'est un état valide : la boutique
    // fonctionne sans supervision. Elle ne doit pas tomber pour autant.
    expect(sentryEnabled()).toBe(false)
    await expect(
      captureException(new Error('x'), { event: 'test.incident' }),
    ).resolves.toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('ne lève pas non plus sur un DSN illisible', async () => {
    process.env.SENTRY_DSN = 'ceci-n-est-pas-une-url'
    __resetSentryForTests()

    expect(sentryEnabled()).toBe(false)
    await expect(
      captureException(new Error('x'), { event: 'test.incident' }),
    ).resolves.toBe(false)
  })

  it('vise l’adresse d’enveloppe déduite du DSN', async () => {
    await captureException(new Error('x'), { event: 'test.incident' })

    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('https://o42.ingest.sentry.io/api/1337/envelope/')
  })

  it('porte la clé dans l’en-tête, jamais dans l’URL', async () => {
    await captureException(new Error('x'), { event: 'test.incident' })

    // Une clé dans une chaîne de requête se retrouve dans les journaux d'accès
    // du tiers, et dans tout ce qui se trouve entre nous et lui.
    expect(sent[0]!.url).not.toContain('cle-publique')

    const headers = sent[0]!.init.headers as Record<string, string>
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=cle-publique')
  })
})

describe('ce qui part, et ce qui ne part pas', () => {
  it('n’envoie NI utilisateur, NI requête, NI en-têtes, NI fil d’Ariane', async () => {
    await captureException(new Error('échec'), {
      event: 'test.incident',
      fields: { orderId: 'cmd_1' },
    })

    const { payload } = parseEnvelope(String(sent[0]!.init.body))

    // Les quatre portes par lesquelles une donnée personnelle entre dans un
    // outil de supervision sans que personne ne l'ait décidé.
    expect(payload.user).toBeUndefined()
    expect(payload.request).toBeUndefined()
    expect(payload.contexts).toBeUndefined()
    expect(payload.breadcrumbs).toBeUndefined()
  })

  it('caviarde le message de l’erreur', async () => {
    // Le même défaut que pour le journal : un message Prisma porte l'appel qui
    // a échoué AVEC ses arguments.
    await captureException(
      new Error('where: { email: "camille@exemple.fr" }'),
      { event: 'test.incident' },
    )

    const body = String(sent[0]!.init.body)
    expect(body).not.toContain('camille@exemple.fr')
    expect(body).toContain('caviardé')
  })

  it('caviarde aussi la pile d’appels', async () => {
    // Une pile ne porte normalement que des chemins de fichiers. « Normalement »
    // ne suffit pas : le message figure en tête de `stack`.
    const error = new Error('doublon sur camille@exemple.fr')

    await captureException(error, { event: 'test.incident' })

    const { payload } = parseEnvelope(String(sent[0]!.init.body))
    const extra = payload.extra as Record<string, string>
    expect(extra.stack).toBeDefined()
    expect(extra.stack).not.toContain('camille@exemple.fr')
  })

  it('caviarde les champs additionnels par les mêmes règles que le journal', async () => {
    await captureException(new Error('x'), {
      event: 'test.incident',
      fields: { customerNote: 'chez la voisine', orderId: 'cmd_1' },
    })

    const { payload } = parseEnvelope(String(sent[0]!.init.body))
    const extra = payload.extra as Record<string, unknown>

    expect(extra.customerNote).toBe('[caviardé]')
    // L'identifiant reste : sans lui, l'incident ne se relie à rien.
    expect(extra.orderId).toBe('cmd_1')
  })

  it('relie l’incident au journal par le même nom d’événement', async () => {
    await captureException(new Error('x'), { event: 'rate_limit.backend_unavailable' })

    const { payload } = parseEnvelope(String(sent[0]!.init.body))
    expect(payload.logger).toBe('rate_limit.backend_unavailable')
    expect((payload.tags as Record<string, string>).event).toBe(
      'rate_limit.backend_unavailable',
    )
  })

  it('compose une enveloppe conforme : trois lignes, un identifiant hexadécimal', async () => {
    await captureException(new Error('x'), { event: 'test.incident' })

    const body = String(sent[0]!.init.body)
    expect(body.split('\n')).toHaveLength(3)

    const { header, itemHeader, payload } = parseEnvelope(body)
    expect(itemHeader.type).toBe('event')
    // 32 hexadécimaux sans tirets : le format qu'attend Sentry. Un UUID avec
    // ses tirets est refusé, et le refus ne se voit que côté Sentry.
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(payload.event_id).toBe(header.event_id)
  })
})

describe('une panne de Sentry ne devient pas une panne du site', () => {
  it('encaisse un refus sans lever, et n’en journalise pas le corps', async () => {
    vi.stubGlobal('fetch', async () =>
      // Une réponse d'erreur peut renvoyer la requête reçue, donc tout ce qu'on
      // vient de composer. On n'en garde que le code.
      new Response('camille@exemple.fr', { status: 429 }),
    )

    await expect(
      captureException(new Error('x'), { event: 'test.incident' }),
    ).resolves.toBe(false)
  })

  it('encaisse une injoignabilité sans lever', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('réseau indisponible')
    })

    await expect(
      captureException(new Error('x'), { event: 'test.incident' }),
    ).resolves.toBe(false)
  })

  it('n’essaie pas de remonter à Sentry la panne de Sentry', async () => {
    // Sans quoi chaque incident en produirait deux, puis quatre : une panne du
    // prestataire deviendrait une tempête d'appels sortants.
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw new Error('réseau indisponible')
    })

    await captureException(new Error('x'), { event: 'test.incident' })
    expect(calls).toBe(1)
  })

  it('journalise l’incident même quand Sentry n’est pas branché', async () => {
    delete process.env.SENTRY_DSN
    __resetSentryForTests()

    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    await captureException(new Error('échec'), { event: 'test.incident' })

    // Le journal est la trace de référence ; Sentry n'est qu'une façon d'être
    // prévenu. Brancher l'un ne doit pas être la condition de l'autre.
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).event).toBe('test.incident')
  })
})
