import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  redactText,
  redactFields,
  describeError,
  REDACTED,
} from '@/lib/observability/redact'
import { logger } from '@/lib/observability/logger'

/**
 * Ce qui n'a pas le droit d'entrer dans un journal.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier vit dans `tests/security` et non dans `tests/domain`
 * ---------------------------------------------------------------------------
 * Un journal est une COPIE de données personnelles, conservée ailleurs que la
 * base, souvent plus longtemps qu'elle, et lue par des gens qui n'ont aucune
 * raison d'accéder à l'identité des clientes. La page de confidentialité
 * annonce des durées de conservation ; un journal qui recopie une adresse
 * e-mail les contredit sans que personne ne s'en aperçoive.
 *
 * Ce n'est donc pas une commodité de format qu'on vérifie ici, c'est une
 * promesse publiée.
 */

describe('caviardage par la forme de la valeur', () => {
  it('retire une adresse e-mail où qu’elle se trouve', () => {
    // LE cas qui motive tout ce module. Un message d'erreur Prisma porte
    // l'appel qui a échoué AVEC ses arguments : une lecture ratée sur
    // `findUnique({ where: { email } })` inscrivait l'adresse en clair.
    const message =
      'Invalid `prisma.user.findUnique()` invocation: where: { email: "camille.roy@exemple.fr" }'

    const cleaned = redactText(message)

    expect(cleaned).not.toContain('camille.roy@exemple.fr')
    expect(cleaned).toContain(REDACTED)
    // Le reste est CONSERVÉ : sans lui, la ligne ne sert plus à comprendre.
    expect(cleaned).toContain('prisma.user.findUnique')
  })

  it('retire plusieurs adresses dans le même texte', () => {
    const cleaned = redactText('de a@exemple.fr vers b@exemple.fr')
    expect(cleaned).not.toMatch(/@exemple\.fr/)
    expect(cleaned.match(new RegExp(REDACTED.replace(/[[\]]/g, '\\$&'), 'g'))).toHaveLength(2)
  })

  it('retire les clés de prestataire', () => {
    // Une clé dans un journal est une clé publiée : les journaux se copient
    // dans des tickets et se collent dans des conversations.
    for (const key of [
      'sk_live_51NabcdefghijKLMNOP',
      'sk_test_51NabcdefghijKLMNOP',
      'rk_live_abcdefghijklmnop',
      'whsec_abcdefghijklmnopqrst',
    ]) {
      const cleaned = redactText(`Stripe a refusé : ${key}`)
      expect(cleaned, key).not.toContain(key)
      expect(cleaned, key).toContain(REDACTED)
    }
  })

  it('retire un jeton porteur et un jeton à trois segments', () => {
    expect(redactText('Authorization: Bearer abc.def-ghi_jkl=')).not.toContain('abc.def')
    expect(
      redactText('jeton eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij'),
    ).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  it('retire une adresse IP littérale', () => {
    // Le projet ne conserve JAMAIS d'IP brute — les compteurs anti-force-brute
    // travaillent sur une empreinte non réversible. Un message d'erreur réseau
    // en faisait pourtant remonter.
    const cleaned = redactText('connexion refusée vers 203.0.113.11:5432')
    expect(cleaned).not.toContain('203.0.113.11')
  })

  it('laisse intact ce qui doit rester lisible', () => {
    // Un journal entièrement caviardé n'est pas plus prudent : il est
    // simplement inutile, et un journal inutile finit par être remplacé par un
    // journal bavard.
    const texte = 'commande cmd_01HZX8 en échec après 3 tentatives (503)'
    expect(redactText(texte)).toBe(texte)
  })
})

describe('caviardage par le nom du champ', () => {
  it('retire la valeur des champs sensibles, garde leur nom', () => {
    const fields = redactFields({
      guestEmail: 'camille@exemple.fr',
      customerNote: 'laissez chez la voisine du 3e',
      trackingNumber: 'LA123456789FR',
      phone: '+33612345678',
      city: 'Lille',
      postalCode: '59000',
      sessionToken: 'abcdef',
      authorization: 'Bearer x',
    })

    for (const [key, value] of Object.entries(fields)) {
      expect(value, key).toBe(REDACTED)
    }
    // Le NOM survit : savoir qu'un champ `guestEmail` était en jeu aide à
    // comprendre la panne ; sa valeur n'aide en rien.
    expect(Object.keys(fields)).toContain('guestEmail')
  })

  it('attrape les variantes sans qu’on ait à les énumérer', () => {
    // Comparaison par inclusion, exprès : une liste de noms exacts devrait
    // s'allonger à chaque variante, et c'est la variante oubliée qui fuit.
    const fields = redactFields({
      email: 'a@b.fr',
      guestEmail: 'a@b.fr',
      billingEmailAddress: 'a@b.fr',
      shopEmail: 'a@b.fr',
    })
    expect(Object.values(fields)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED])
  })

  it('ne caviarde pas un nom innocent qui contient par hasard un motif court', () => {
    // `ip` est court : sans frontière de mot, `description` et `recipient`
    // seraient caviardés — et un journal qui perd sa description ne sert plus.
    const fields = redactFields({ description: 'pull en laine', recipe: 'x' })
    expect(fields.description).toBe('pull en laine')
    expect(fields.recipe).toBe('x')
  })

  it('caviarde bien les vrais champs d’adresse IP', () => {
    const fields = redactFields({ ip: '203.0.113.11', clientIp: 'x', ip_address: 'y' })
    expect(Object.values(fields)).toEqual([REDACTED, REDACTED, REDACTED])
  })

  it('garde les identifiants internes, et c’est délibéré', () => {
    // Ce sont des références pseudonymes : elles ne disent rien à qui n'a pas
    // la base, et sans elles on ne peut plus relier un échec à ce qui a échoué.
    // C'est le choix déjà assumé par la file de travaux différés.
    const fields = redactFields({
      orderId: 'cmd_01HZX8',
      articleId: 'art_42',
      jobId: 'job_7',
      attempts: 6,
    })
    expect(fields.orderId).toBe('cmd_01HZX8')
    expect(fields.articleId).toBe('art_42')
    expect(fields.attempts).toBe(6)
  })

  it('applique AUSSI le filtre de forme aux champs au nom innocent', () => {
    // Les deux filtres sont nécessaires : celui-ci seul manquerait `city`,
    // celui du nom seul manquerait ceci — et `message` est le nom le plus
    // innocent qui soit.
    const fields = redactFields({ message: 'échec pour camille@exemple.fr' })
    expect(fields.message).not.toContain('camille@exemple.fr')
  })

  it('borne la longueur d’une valeur textuelle', () => {
    // Une trace Prisma complète fait plusieurs milliers de caractères. Plus le
    // texte est long, plus il a de chances de porter une valeur qu'aucun motif
    // n'attrape.
    const fields = redactFields({ message: 'x'.repeat(2_000) })
    expect(String(fields.message).length).toBeLessThan(600)
  })

  it('écarte les champs absents plutôt que d’écrire « undefined »', () => {
    expect(redactFields({ a: undefined, b: 1 })).toEqual({ b: 1 })
  })
})

describe('description d’une erreur', () => {
  it('ne garde que le nom et le message caviardé', () => {
    const error = new Error('doublon sur camille@exemple.fr')
    error.name = 'PrismaClientKnownRequestError'

    const described = describeError(error)

    expect(described.errorName).toBe('PrismaClientKnownRequestError')
    expect(described.errorMessage).not.toContain('camille@exemple.fr')
    expect(described.errorMessage).toContain('doublon')
    // Surtout : aucune clé de plus. Pas de pile, pas de cause, pas de `meta`
    // Prisma — c'est dans `meta` que voyagent les valeurs de colonnes.
    expect(Object.keys(described).sort()).toEqual(['errorMessage', 'errorName'])
  })

  it('ne tente pas de sérialiser un objet inconnu', () => {
    // Une valeur levée qui n'est ni `Error` ni chaîne peut porter n'importe
    // quoi. On dit de quoi il s'agit, on ne le recopie pas.
    const described = describeError({ email: 'camille@exemple.fr', deep: { a: 1 } })
    expect(described.errorMessage).toBe(REDACTED)
    expect(JSON.stringify(described)).not.toContain('camille')
  })

  it('caviarde aussi une chaîne levée telle quelle', () => {
    expect(describeError('échec pour a@b.fr').errorMessage).not.toContain('a@b.fr')
  })
})

describe('le journal lui-même', () => {
  let lines: string[]

  beforeEach(() => {
    lines = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('écrit UNE ligne de JSON, jamais un objet indenté', () => {
    // Les collecteurs découpent la sortie par ligne : un JSON indenté sur douze
    // lignes devient douze entrées, dont onze illisibles.
    logger.error('test.evenement', { orderId: 'cmd_1' })

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('\n')

    const parsed = JSON.parse(lines[0]!)
    expect(parsed.level).toBe('error')
    expect(parsed.event).toBe('test.evenement')
    expect(parsed.orderId).toBe('cmd_1')
    expect(typeof parsed.ts).toBe('string')
  })

  it('envoie les erreurs et les avertissements sur la sortie d’erreur', () => {
    // Sans cela, une alerte réglée sur stderr ne verrait jamais nos
    // avertissements.
    const onError = vi.spyOn(console, 'error')
    logger.warn('test.avertissement')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('ne laisse passer aucune donnée personnelle, même par un champ innocent', () => {
    logger.failure(
      'test.echec',
      new Error('where: { email: "camille@exemple.fr" }'),
      { customerNote: 'chez la voisine', orderId: 'cmd_1' },
    )

    const line = lines[0]!
    expect(line).not.toContain('camille@exemple.fr')
    expect(line).not.toContain('chez la voisine')
    // L'identifiant, lui, reste : c'est ce qui rend la ligne exploitable.
    expect(line).toContain('cmd_1')
  })

  it('ne casse pas la requête quand un champ est illisible', () => {
    // Un journal qui fait tomber le service qu'il observe est pire que pas de
    // journal du tout.
    const circulaire: Record<string, unknown> = {}
    circulaire.self = circulaire

    expect(() =>
      logger.error('test.circulaire', {
        // Volontairement mal typé : le contrat dit « scalaires », et ce test
        // vérifie ce qui arrive quand quelqu'un ne le respecte pas.
        boom: circulaire as never,
      }),
    ).not.toThrow()
    expect(lines).toHaveLength(1)
  })

  it('reste muet en dessous du niveau plancher', () => {
    // `debug` est muet par défaut, y compris en production : une ligne par
    // lecture de configuration multiplierait le volume pour un intérêt qui ne
    // dure que le temps d'une enquête.
    logger.debug('test.debug')
    expect(lines).toHaveLength(0)
  })
})
