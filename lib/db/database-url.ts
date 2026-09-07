/**
 * Résolution de l'URL de connexion PostgreSQL.
 *
 * Les hébergeurs ne s'accordent pas sur le nom de la variable :
 *
 *  - Prisma et la convention générale : `DATABASE_URL`
 *  - intégration Vercel Postgres      : `POSTGRES_PRISMA_URL` (pooled),
 *                                       `POSTGRES_URL`,
 *                                       `POSTGRES_URL_NON_POOLING`
 *  - intégration Neon                 : `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
 *
 * Exiger `DATABASE_URL` obligeait à recopier une variable à la main pour
 * rattraper cette divergence. On accepte donc les alias connus, en préférant
 * toujours la valeur explicite quand elle existe.
 */

/** Environnement lu : seules des clés arbitraires nous intéressent. */
type EnvLike = Record<string, string | undefined>

/** Connexion applicative. Un pool convient, et est même préférable en serverless. */
const RUNTIME_KEYS = [
  'DATABASE_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
] as const

/**
 * Connexion des migrations.
 *
 * `prisma migrate` s'appuie sur des verrous consultatifs, que les poolers en
 * mode transaction ne gèrent pas : on privilégie donc explicitement les URL
 * non poolées avant de se rabattre sur la connexion applicative.
 */
const MIGRATION_KEYS = [
  'DIRECT_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_UNPOOLED',
  ...RUNTIME_KEYS,
] as const

/**
 * Nettoie une chaîne de connexion recopiée à la main.
 *
 * Une valeur collée depuis un fichier `.env` traîne souvent avec elle le nom
 * de la variable et les guillemets qui l'encadrent. Une interface web les
 * conserve tels quels, et PostgreSQL reçoit alors une chaîne commençant par
 * un guillemet : Prisma répond « P1013 : the scheme is not recognized »,
 * message qui ne désigne pas la cause.
 *
 * On préfère absorber ces deux cas plutôt que d'exiger un copier-coller
 * parfait.
 */
export function normalizeConnectionString(raw: string): string {
  return encodeUserinfo(stripWrapping(raw))
}

/** Retire l'emballage — espaces, préfixe `NOM=`, guillemets — sans rien encoder. */
function stripWrapping(raw: string): string {
  let value = raw.trim()

  // Préfixe « NOM= » recopié depuis un .env. On ne le retire que si ce qui
  // suit ressemble vraiment à une chaîne de connexion, pour ne jamais
  // amputer un mot de passe contenant un « = ».
  const prefixed = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/s.exec(value)
  if (prefixed?.[2] && /^["']?(postgres|postgresql):\/\//i.test(prefixed[2])) {
    value = prefixed[2].trim()
  }

  // Guillemets encadrants, simples ou doubles.
  const first = value.charAt(0)
  if ((first === '"' || first === "'") && value.endsWith(first)) {
    value = value.slice(1, -1).trim()
  }

  return value
}

/**
 * La chaîne a-t-elle dû être réparée pour être exploitable ?
 *
 * Sert uniquement à la trace de build : savoir qu'un encodage a eu lieu évite
 * de chercher ailleurs si la connexion échoue malgré tout.
 */
export function wasUserinfoEncoded(raw: string): boolean {
  const stripped = stripWrapping(raw)
  return encodeUserinfo(stripped) !== stripped
}

/**
 * Encode les caractères réservés laissés tels quels dans les identifiants.
 *
 * Un mot de passe contenant « @ » produit une URL à deux séparateurs
 * possibles entre identifiants et hôte. `new URL` ne s'en plaint pas — elle
 * retient silencieusement le dernier — mais le pilote PostgreSQL, lui, se
 * connecte au mauvais hôte, et Prisma répond P1001 sans jamais désigner la
 * cause.
 *
 * Le cas est pourtant réparable sans la moindre ambiguïté : un nom d'hôte ne
 * peut pas contenir « @ », donc le DERNIER « @ » de l'autorité est forcément
 * le séparateur, et tout ce qui le précède appartient aux identifiants. On
 * encode donc plutôt que d'exiger un mot de passe recopié à la main dans une
 * interface web — opération qu'il faudrait refaire à chaque rotation.
 *
 * La réparation est sans perte : le pilote décode « %40 » en « @ », le mot de
 * passe transmis est exactement celui qui était écrit.
 *
 * Limite assumée : un « / » dans le mot de passe reste irrécupérable. Il est
 * indiscernable du séparateur qui ouvre le nom de la base, et aucune règle ne
 * permet de trancher. `describeConnectionProblem` s'en charge.
 */
function encodeUserinfo(value: string): string {
  const scheme = value.indexOf('://')
  if (scheme === -1) return value

  const start = scheme + 3

  // Fin de l'autorité : le premier « / » après le schéma, ou la fin de la
  // chaîne. « # » et « ? » n'entrent pas dans ce calcul — s'ils se trouvent
  // dans le mot de passe, ils sont avant ce « / » et seront encodés avec le
  // reste.
  const slash = value.indexOf('/', start)
  const end = slash === -1 ? value.length : slash
  const authority = value.slice(start, end)

  const separator = authority.lastIndexOf('@')
  if (separator === -1) return value

  const userinfo = authority.slice(0, separator)
  const hostPort = authority.slice(separator + 1)

  // Sans « : », il n'y a pas de mot de passe : rien à réparer.
  const colon = userinfo.indexOf(':')
  if (colon === -1) return value

  const encode = (part: string): string =>
    part.replace(
      /[@#?:]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )

  const repaired = `${encode(userinfo.slice(0, colon))}:${encode(
    userinfo.slice(colon + 1),
  )}`

  if (repaired === userinfo) return value

  return `${value.slice(0, start)}${repaired}@${hostPort}${value.slice(end)}`
}

/** Décrit ce qui cloche dans une chaîne de connexion, ou `null` si elle est valide. */
export function describeConnectionProblem(value: string): string | null {
  if (!/^(postgres|postgresql):\/\//i.test(value)) {
    // Aucun extrait, même court. « On ne montre que l'amorce » supposait que
    // le mot de passe vient après « :// » — vrai pour une chaîne bien formée,
    // faux précisément dans le cas qu'on est en train de diagnostiquer. Une
    // valeur mal collée peut commencer par n'importe quoi, mot de passe
    // compris.
    return (
      'la chaîne ne commence pas par « postgresql:// ». Vérifiez qu’aucun ' +
      'préfixe ni guillemet n’a été collé avec elle'
    )
  }

  // Un « @ » non encodé dans le mot de passe rend l'URL ambiguë : il y a
  // alors deux séparateurs possibles entre identifiants et hôte. `new URL`
  // ne s'en plaint pas — elle retient silencieusement le dernier — mais le
  // pilote PostgreSQL, lui, se connecte au mauvais hôte.
  const authority = value.slice(value.indexOf('://') + 3).split('/')[0] ?? ''
  const atCount = (authority.match(/@/g) ?? []).length
  if (atCount > 1) {
    return (
      'le mot de passe contient un « @ » non encodé, ce qui rend l’URL ' +
      'ambiguë. Remplacez-le par %40 (de même : # → %23, / → %2F, ? → %3F, ' +
      ': → %3A)'
    )
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return (
      'la chaîne n’est pas une URL valide. Un caractère spécial du mot de ' +
      'passe doit être encodé (@ → %40, # → %23, / → %2F)'
    )
  }

  // Marqueur laissé tel quel. Les hébergeurs insèrent un texte à remplacer
  // là où ils ne peuvent pas connaître la valeur — un mot de passe n'est
  // jamais stocké en clair de leur côté. Oublier la substitution produit une
  // erreur d'authentification qui laisse chercher ailleurs.
  const password = decodeURIComponent(parsed.password)

  // Détection RESSERRÉE sur les marqueurs réellement émis par les hébergeurs.
  //
  // La version précédente traitait « tout texte entre crochets » comme un
  // marqueur, et INTERPOLAIT le fragment déclencheur dans son message. Un mot
  // de passe parfaitement valide contenant une paire de crochets — cas courant
  // avec un générateur — voyait donc un morceau de sa valeur réelle écrit dans
  // le journal de build Vercel, conservé sans limite et lisible par qui détient
  // un lien de déploiement.
  //
  // Le message ne cite plus jamais le contenu : il nomme la CLASSE de marqueur.
  const placeholder =
    /YOUR[-_]?PASSWORD|\[YOUR[-_][^\]]*\]|<YOUR[-_][^>]*>|<password>|\[password\]/i.test(
      password,
    )

  if (placeholder) {
    return (
      'le mot de passe est encore le texte à remplacer fourni par ' +
      'l’hébergeur. Utilisez le mot de passe de votre base — Supabase : ' +
      'Project Settings → Database → Reset database password si vous ne ' +
      'l’avez plus'
    )
  }

  if (password === '') {
    return 'aucun mot de passe n’est renseigné dans la chaîne de connexion'
  }

  // Les poolers Supabase routent la connexion d'après l'identifiant : il doit
  // porter la référence du projet, sous la forme `postgres.<ref>`. Avec le
  // simple `postgres` — celui de la connexion directe — l'authentification
  // échoue quel que soit le mot de passe, et Prisma se contente d'un
  // « P1000 : credentials are not valid » qui laisse chercher du côté du mot
  // de passe.
  if (
    parsed.hostname.endsWith('.pooler.supabase.com') &&
    parsed.username === 'postgres'
  ) {
    return (
      'le pooler Supabase attend l’identifiant « postgres.<référence-du-projet> », ' +
      'pas « postgres » seul. L’identifiant sans suffixe n’appartient qu’à la ' +
      'connexion directe (hôte db.<référence>.supabase.co). Reprenez la chaîne ' +
      'depuis Supabase : Connect → ORMs → Prisma'
    )
  }

  // Cas symétrique : identifiant du pooler sur l'hôte de connexion directe.
  if (
    parsed.hostname.endsWith('.supabase.co') &&
    parsed.username.startsWith('postgres.')
  ) {
    return (
      'la connexion directe attend l’identifiant « postgres » seul, sans la ' +
      'référence du projet. Celle-ci n’est requise que sur les hôtes ' +
      '*.pooler.supabase.com'
    )
  }

  return null
}

/** Connexion retenue. `repaired` signale qu'un caractère a dû être encodé. */
export interface ResolvedConnection {
  key: string
  value: string
  repaired: boolean
}

function firstNonEmpty(
  keys: readonly string[],
  env: EnvLike,
): ResolvedConnection | null {
  for (const key of keys) {
    const raw = env[key]
    if (typeof raw !== 'string' || raw.trim() === '') continue

    return {
      key,
      value: normalizeConnectionString(raw),
      // Des guillemets retirés ne sont pas une réparation d'identifiants et
      // n'ont pas à être signalés comme telle.
      repaired: wasUserinfoEncoded(raw),
    }
  }
  return null
}

export function resolveDatabaseUrl(
  env: EnvLike = process.env,
): ResolvedConnection | null {
  const found = firstNonEmpty(RUNTIME_KEYS, env)
  if (!found) return null

  // La connexion applicative peut légitimement passer par un pooler ; on la
  // complète pour que Prisma s'y comporte correctement.
  return { ...found, value: withPoolerParams(found.value) }
}

export function resolveMigrationUrl(
  env: EnvLike = process.env,
): ResolvedConnection | null {
  return firstNonEmpty(MIGRATION_KEYS, env)
}

/**
 * Une connexion passe-t-elle par un pooler en mode transaction ?
 *
 * Supabase sert son pooler sur le port 6543 et sur un hôte `*.pooler.*` ;
 * Neon et Vercel Postgres utilisent un hôte suffixé `-pooler`.
 */
export function looksPooled(url: string): boolean {
  return (
    url.includes('-pooler') ||
    url.includes('.pooler.') ||
    url.includes(':6543') ||
    url.includes('pgbouncer=true')
  )
}

/**
 * Le pooler est-il en mode TRANSACTION, incompatible avec les migrations ?
 *
 * Distinction importante chez Supabase : le même hôte `*.pooler.*` sert le
 * mode transaction sur le port 6543 et le mode SESSION sur le port 5432. Le
 * mode session conserve l'état de connexion, donc gère les verrous
 * consultatifs : les migrations y passent sans problème. Avertir sur le seul
 * nom d'hôte produirait une alerte à tort dans la configuration Supabase la
 * plus courante.
 */
export function blocksMigrations(url: string): boolean {
  return url.includes(':6543') || url.includes('pgbouncer=true')
}

/**
 * Complète une URL poolée des paramètres qu'attend Prisma.
 *
 * PgBouncer en mode transaction ne conserve pas l'état de session : sans
 * `pgbouncer=true`, Prisma émet des requêtes préparées qui échouent au bout
 * de quelques appels avec « prepared statement "s0" already exists ». Le
 * défaut passe donc inaperçu au déploiement et ne se manifeste qu'en charge.
 *
 * `connection_limit=1` est la recommandation de Prisma derrière un pooler :
 * chaque instance serverless n'ouvre qu'une connexion, la mutualisation étant
 * déjà assurée en amont.
 */
export function withPoolerParams(url: string): string {
  if (!looksPooled(url)) return url

  const params: string[] = []
  if (!/[?&]pgbouncer=/.test(url)) params.push('pgbouncer=true')
  if (!/[?&]connection_limit=/.test(url)) params.push('connection_limit=1')
  if (params.length === 0) return url

  return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`
}

/** Remplace un paramètre s'il existe, l'ajoute sinon. */
function setParam(url: string, name: string, value: string): string {
  const existing = new RegExp(`([?&])${name}=[^&]*`)
  if (existing.test(url)) return url.replace(existing, `$1${name}=${value}`)
  return `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`
}

/**
 * ===========================================================================
 * LA DISTANCE À LA BASE EST UN RÉGLAGE, ET C'EST LE PLUS LOURD DE TOUS
 * ===========================================================================
 * Ce fichier décide de la FORME des connexions. Leur longueur, elle, se règle
 * dans `vercel.json`, à la clé `regions` — et les deux se lisent ensemble.
 *
 * Sans cette clé, Vercel place les fonctions dans sa région par défaut : iad1,
 * Washington. La base Supabase est à Paris (eu-west-3). Chaque requête SQL
 * traversait donc l'Atlantique deux fois.
 *
 * Trois grandeurs se MULTIPLIENT, et c'est leur produit qui faisait les
 * secondes d'attente à chaque clic :
 *
 *   - le nombre de requêtes par page — mesuré entre quinze et vingt-deux ;
 *   - l'aller-retour vers la base — environ 85 ms d'un continent à l'autre,
 *     contre moins de deux sur place ;
 *   - le `connection_limit=1` posé plus haut, qui les SÉRIALISE : les
 *     `Promise.all` du code ne se recouvrent pas en production, ils font la
 *     queue sur l'unique connexion.
 *
 * Vingt requêtes × 85 ms = près de deux secondes d'attente pure, avant même
 * que la page ne commence à s'écrire. `regions: ["cdg1"]` — Paris, la ville de
 * la base — ramène ce produit sous les cinquante millisecondes.
 *
 * Le jour où la base déménage, cette région déménage avec elle. Ce n'est pas
 * leur valeur qui compte, c'est leur ÉCART.
 *
 * ---------------------------------------------------------------------------
 * Combien de processus prérendent les pages, et combien de connexions chacun
 * a le droit d'ouvrir.
 *
 * ---------------------------------------------------------------------------
 * Ces deux nombres se multiplient, et leur produit a un plafond
 * ---------------------------------------------------------------------------
 * Next prérend sur un worker PAR CŒUR, chaque worker étant un processus
 * distinct avec son propre client Prisma — donc son propre pool. Le nombre de
 * connexions ouvertes vers la base est le PRODUIT des deux, et il se compare à
 * un plafond que la base impose.
 *
 * Chez Supabase, le pooler en mode session (port 5432) limite le nombre de
 * clients à `pool_size`, soit quinze par défaut. Au-delà, la connexion suivante
 * n'attend pas : elle est refusée, avec
 * « (EMAXCONNSESSION) max clients reached in session mode ».
 *
 * ---------------------------------------------------------------------------
 * Les deux builds qui ont échoué, et ce qu'ils ont appris
 * ---------------------------------------------------------------------------
 * PREMIER ÉCHEC. Huit connexions par worker, deux cœurs : seize demandées pour
 * quinze. Le prérendu s'arrêtait à la 67ᵉ page sur 269, sur `/pt/marques`.
 * Corrigé en ramenant le produit à dix.
 *
 * SECOND ÉCHEC, avec ce produit de dix. Même erreur, même page, à la 69ᵉ sur
 * 277. Le compte, lui, était juste : mesuré sur un build complet en comptant
 * `pg_stat_activity`, le prérendu ouvre EXACTEMENT dix connexions, ni une de
 * plus. L'arithmétique n'était pas en cause.
 *
 * C'était la PRÉMISSE. Elle tenait dans un mot jamais écrit : « disponibles ».
 * On raisonnait comme si les quinze places du pooler revenaient au build. Or
 * un build Vercel ne remplace pas le site, il le double : le déploiement en
 * cours continue de servir pendant toute la construction, et chacune de ses
 * instances tient sa connexion sur le MÊME pooler. Le build n'a jamais eu
 * quinze places ; il a celles que la production ne prend pas.
 *
 * D'où la forme du défaut, qui expliquait tout et qu'on avait mal lue : le
 * build échouait à peu près à la même page avec huit connexions par worker et
 * avec cinq. Si le produit avait été la cause, le second aurait tenu bien plus
 * longtemps. Un seuil franchi au même endroit quelle que soit la consommation,
 * c'est le signe que le plafond, lui, bouge.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi épingler le nombre de workers
 * ---------------------------------------------------------------------------
 * Sans cela, le produit dépend de la machine qui construit : deux cœurs
 * aujourd'hui, huit demain, et le plafond serait franchi de nouveau sans
 * qu'une ligne de code ait bougé. `next.config.ts` impose donc ce nombre, et
 * la limite par worker s'en déduit — l'arithmétique est écrite une fois, ici.
 */
export const BUILD_WORKERS = 2

/**
 * Places du pooler Supabase en mode session (port 5432), `pool_size` par
 * défaut. Au-delà, la connexion suivante n'attend pas : elle est REFUSÉE, avec
 * « (EMAXCONNSESSION) max clients reached in session mode ».
 */
export const PLAFOND_POOLER = 15

/**
 * Places laissées au SITE EN SERVICE pendant que le build tourne.
 *
 * C'est le terme qui manquait, et il ne se déduit d'aucun réglage de build :
 * il décrit ce qui se passe à côté. Chaque instance serverless chaude tient
 * une connexion — une seule, grâce au `connection_limit=1` que
 * `withPoolerParams` pose sur la connexion applicative — et leur nombre suit
 * le trafic, pas le déploiement.
 *
 * Huit couvre confortablement une boutique de cette taille. Le jour où le
 * trafic la dépasse, c'est la RÉSERVE qu'il faut relever, pas le budget du
 * build : se tromper de terme est exactement ce qui a produit le second échec.
 */
export const RESERVE_APPLICATION = 8

/**
 * Ce que le build s'autorise.
 *
 * Il ne se choisit plus : il se DÉDUIT de ce qui reste une fois la production
 * servie et une marge gardée pour la connexion des migrations, qui vient de se
 * fermer mais que le pooler peut encore compter.
 */
export const BUILD_TOTAL_CONNECTIONS = 4

export const BUILD_CONNECTION_LIMIT = Math.max(
  2,
  Math.floor(BUILD_TOTAL_CONNECTIONS / BUILD_WORKERS),
)

/**
 * Un pool plus étroit met forcément plus de requêtes en file.
 *
 * Le délai passe donc de trente à soixante secondes. Ce n'est pas une
 * précaution vague : depuis la région de build, un aller-retour vers la base
 * coûte une centaine de millisecondes, et c'est l'attente cumulée — pas la
 * durée d'une requête — que Prisma compare à ce délai avant de répondre P2024.
 * Rétrécir le pool sans allonger le délai, c'est échanger une panne contre
 * l'autre.
 */
export const BUILD_POOL_TIMEOUT_SECONDS = 60

/**
 * Profil de connexion du build.
 *
 * `connection_limit=1` est la recommandation de Prisma derrière un pooler, et
 * elle est juste — POUR L'APPLICATION. Chaque instance serverless est
 * éphémère et ne traite qu'une requête à la fois ; la mutualisation est
 * assurée en amont.
 *
 * Le build n'a rien de tout cela : c'est un processus long qui prérend la
 * totalité des pages, en parallèle. Avec une seule connexion, les requêtes
 * font la queue, et comme chaque aller-retour vers la base coûte une centaine
 * de millisecondes depuis la région de build, l'attente dépasse le délai du
 * pool. Prisma répond alors P2024 et le build s'arrête, alors que la base se
 * porte très bien.
 *
 * L'hôte et le port restent ceux de la connexion applicative : seul le profil
 * de pool change. Cette URL ne sort jamais du build — `lib/db/client.ts`
 * résout la sienne à l'exécution, depuis l'environnement de la fonction.
 */
export function withBuildParams(url: string): string {
  return setParam(
    setParam(url, 'connection_limit', String(BUILD_CONNECTION_LIMIT)),
    'pool_timeout',
    String(BUILD_POOL_TIMEOUT_SECONDS),
  )
}

/**
 * Noms — jamais les valeurs — des variables liées à la base présentes dans
 * l'environnement. Sert au diagnostic de build : une URL de connexion contient
 * un mot de passe et n'a rien à faire dans un journal.
 */
export function presentDatabaseEnvNames(
  env: EnvLike = process.env,
): string[] {
  return Object.keys(env)
    .filter((key) => /^(DATABASE|POSTGRES|PG|NEON|SUPABASE)/.test(key))
    .filter((key) => {
      const value = env[key]
      return typeof value === 'string' && value.trim() !== ''
    })
    .sort()
}
