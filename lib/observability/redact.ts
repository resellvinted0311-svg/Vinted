/**
 * Ce qui n'a pas le droit d'entrer dans un journal — règles pures, sans I/O.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce module existe séparément du journal
 * ---------------------------------------------------------------------------
 * Un journal est une COPIE de données, conservée ailleurs, souvent plus
 * longtemps que la base, et lue par des gens qui n'ont aucune raison d'accéder
 * à l'identité des clientes. La page de confidentialité annonce des durées de
 * conservation ; un journal qui recopie une adresse e-mail les contredit sans
 * que personne ne s'en aperçoive.
 *
 * Ces règles sont donc pures et testées sans rien écrire nulle part : c'est la
 * seule façon d'exercer sérieusement les cas qui comptent, à commencer par
 * celui décrit ci-dessous.
 *
 * ---------------------------------------------------------------------------
 * Le défaut mesuré que ce module vient corriger
 * ---------------------------------------------------------------------------
 * Plusieurs appels journalisaient l'objet `Error` LUI-MÊME :
 *
 *     console.error('[auth] Session illisible.', error)
 *
 * Un `Error` venu de Prisma porte, dans son `message`, l'appel qui a échoué
 * avec ses ARGUMENTS. Une lecture ratée sur `prisma.user.findUnique({ where:
 * { email } })` inscrit donc l'adresse e-mail en clair dans les journaux du
 * serveur. Personne ne l'a voulu, et rien ne le signalait.
 *
 * ---------------------------------------------------------------------------
 * Deux filtres, et il faut les deux
 * ---------------------------------------------------------------------------
 * Par le NOM du champ : `email`, `phone`, `token`… Suffisant quand on nomme
 * correctement ce qu'on journalise, aveugle dès que la donnée voyage sous un
 * nom innocent — et `message` est le nom le plus innocent qui soit.
 *
 * Par la FORME de la valeur : ce qui ressemble à une adresse e-mail, à une clé
 * de prestataire, à un jeton porteur. C'est ce filtre-là qui attrape le cas
 * Prisma ci-dessus, et lui seul.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'on NE caviarde PAS, et pourquoi
 * ---------------------------------------------------------------------------
 * Les identifiants internes — `orderId`, `articleId`, `jobId`. Ce sont des
 * références pseudonymes : elles ne disent rien à qui n'a pas la base, et sans
 * elles un journal ne sert plus à rien puisqu'on ne peut plus relier un échec à
 * ce qui a échoué. C'est le choix déjà fait pour la file de travaux différés,
 * dont l'en-tête assume de ne porter qu'un identifiant de commande.
 *
 * Un journal entièrement caviardé n'est pas plus prudent : il est simplement
 * inutile, et un journal inutile finit par être remplacé par un journal
 * bavard.
 */

/** Ce qu'on accepte de journaliser : des scalaires, jamais un objet libre. */
export type LogValue = string | number | boolean | null | undefined
export type LogFields = Record<string, LogValue>

/** Marque laissée à la place d'une valeur retirée. Visible, donc vérifiable. */
export const REDACTED = '[caviardé]'

/**
 * Noms de champs dont la valeur ne sort jamais.
 *
 * Comparés en minuscules et par INCLUSION : `guestEmail`, `customerEmail` et
 * `email` tombent tous sur `email`. Une liste de noms exacts obligerait à
 * l'allonger à chaque variante, et c'est la variante oubliée qui fuit.
 */
const FORBIDDEN_KEY_PARTS = [
  'email',
  'mail',
  'password',
  'passwd',
  'secret',
  'token',
  'cookie',
  'authorization',
  'apikey',
  'api_key',
  'phone',
  'tel',
  'address',
  'adresse',
  'street',
  'postal',
  'zip',
  'city',
  'firstname',
  'lastname',
  'fullname',
  'note',
  'comment',
  'body',
  'tracking',
  'ip',
] as const

/**
 * `ip` et `tel` sont courts et se retrouveraient dans des mots innocents :
 * `description` et `recipe` contiennent `ip` par accident. On exige donc pour
 * eux un MOT entier, contrairement aux autres.
 */
const SHORT_KEYS = new Set(['ip', 'tel'])

/**
 * Découpe un nom de champ en mots.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce découpage corrige, trouvé par son test
 * ---------------------------------------------------------------------------
 * La première version cherchait une frontière de mot par expression régulière
 * sur le nom MIS EN MINUSCULES — `(^|[^a-z])ip([^a-z]|$)`. Or la mise en
 * minuscules détruit précisément la frontière qu'on cherche : `clientIp`
 * devient `clientip`, où `ip` est précédé d'une lettre. Le champ passait donc
 * le filtre, et une adresse IP entrait dans le journal.
 *
 * On découpe donc AVANT de mettre en minuscules : sur la casse chameau d'abord,
 * puis sur les séparateurs. `clientIp`, `client_ip` et `IP` tombent tous sur le
 * même mot.
 */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function keyIsForbidden(key: string): boolean {
  const lower = key.toLowerCase()
  const parts = words(key)

  return FORBIDDEN_KEY_PARTS.some((needle) =>
    SHORT_KEYS.has(needle) ? parts.includes(needle) : lower.includes(needle),
  )
}

/**
 * Formes de valeurs retirées où qu'elles apparaissent.
 *
 * L'ordre n'a pas d'importance : chaque motif est appliqué à son tour sur le
 * texte, et les remplacements ne se recouvrent pas.
 */
const VALUE_PATTERNS: { name: string; pattern: RegExp }[] = [
  // Adresse e-mail. Le motif est volontairement large : mieux vaut caviarder
  // une chaîne qui y ressemble sans en être une que laisser passer l'inverse.
  {
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  // Clés de prestataires. `sk_` et `rk_` chez Stripe, `whsec_` pour la
  // signature de webhook. Une clé dans un journal est une clé publiée : les
  // journaux se partagent, se copient dans des tickets, se collent dans des
  // conversations.
  {
    name: 'provider-key',
    pattern: /\b(sk|rk|whsec|pk_live)_[A-Za-z0-9_-]{6,}/g,
  },
  // Jeton porteur, tel qu'il apparaît dans un message d'erreur HTTP.
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  // Jeton à trois segments séparés par des points (forme JWT).
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
  },
  // Adresse IPv4 littérale. Le projet ne conserve JAMAIS d'IP brute — les
  // compteurs anti-force-brute travaillent sur une empreinte non réversible —
  // et un message d'erreur réseau en fait pourtant remonter.
  {
    name: 'ipv4',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  },
]

/**
 * Retire d'un texte tout ce qui a la forme d'une donnée personnelle ou d'un
 * secret.
 *
 * Le reste du texte est CONSERVÉ : « Unique constraint failed on the fields:
 * (`email`) » reste parfaitement lisible une fois l'adresse retirée, et c'est
 * précisément ce qu'on veut lire pour comprendre la panne.
 */
export function redactText(input: string): string {
  let output = input
  for (const { pattern } of VALUE_PATTERNS) {
    output = output.replace(pattern, REDACTED)
  }
  return output
}

/**
 * Longueur maximale d'une valeur textuelle journalisée.
 *
 * Une trace Prisma complète fait plusieurs milliers de caractères. Au-delà de
 * ce seuil, on ne comprend plus rien de plus — et un journal facturé au volume
 * n'a pas à porter la requête entière. Surtout : plus le texte est long, plus
 * il a de chances de contenir une valeur qu'aucun motif n'attrape.
 */
const MAX_TEXT_LENGTH = 500

function truncate(value: string): string {
  if (value.length <= MAX_TEXT_LENGTH) return value
  return `${value.slice(0, MAX_TEXT_LENGTH)}…`
}

/** Applique les deux filtres à un ensemble de champs. */
export function redactFields(fields: LogFields): LogFields {
  const output: LogFields = {}

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue

    if (keyIsForbidden(key)) {
      // La CLÉ est conservée, la valeur non : savoir qu'un champ `email`
      // était en jeu aide à comprendre ; sa valeur n'aide en rien.
      output[key] = REDACTED
      continue
    }

    output[key] = typeof value === 'string' ? truncate(redactText(value)) : value
  }

  return output
}

/**
 * Ce qu'on garde d'une erreur, et rien de plus.
 *
 * ---------------------------------------------------------------------------
 * Jamais l'objet, jamais la pile
 * ---------------------------------------------------------------------------
 * Le NOM dit la famille du défaut. Le MESSAGE, caviardé, dit ce qui a échoué.
 * La pile d'appels, elle, ne va pas dans le journal texte : elle est longue,
 * illisible en ligne, et c'est à Sentry qu'elle sert — où elle part par un
 * chemin séparé, avec le même caviardage.
 *
 * Une valeur qui n'est pas une `Error` — une chaîne levée, un objet quelconque
 * — est ramenée à sa forme textuelle puis caviardée comme le reste. Rien ne
 * traverse sans passer par le filtre.
 */
export function describeError(error: unknown): {
  errorName: string
  errorMessage: string
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: truncate(redactText(error.message)),
    }
  }

  if (typeof error === 'string') {
    return { errorName: 'string', errorMessage: truncate(redactText(error)) }
  }

  // Ni `Error` ni chaîne : on ne tente pas de sérialiser un objet inconnu, qui
  // pourrait porter n'importe quoi. On dit seulement de quoi il s'agit.
  return { errorName: typeof error, errorMessage: REDACTED }
}
