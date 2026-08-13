/**
 * Résout les URL de base de données et les émet en instructions `export`,
 * destinées à être évaluées par le script de build shell.
 *
 * En cas d'échec, écrit un diagnostic sur la sortie d'erreur listant les NOMS
 * des variables présentes — jamais leurs valeurs, qui contiennent un mot de
 * passe.
 */
import {
  resolveDatabaseUrl,
  resolveMigrationUrl,
  blocksMigrations,
  describeConnectionProblem,
  presentDatabaseEnvNames,
  withBuildParams,
} from '../lib/db/database-url.ts'

const runtime = resolveDatabaseUrl()
const migration = resolveMigrationUrl()

if (!runtime || !migration) {
  const present = presentDatabaseEnvNames()

  console.error('')
  console.error('Aucune connexion PostgreSQL trouvée dans l’environnement.')
  console.error('')
  console.error('Noms cherchés : DATABASE_URL, POSTGRES_PRISMA_URL,')
  console.error('POSTGRES_URL, NEON_DATABASE_URL.')
  console.error('')

  if (present.length > 0) {
    console.error('Variables liées à la base présentes ici :')
    for (const name of present) console.error(`  - ${name}`)
    console.error('')
    console.error('Si l’une d’elles est bien une URL de connexion, recopiez-la')
    console.error('dans DATABASE_URL, ou signalez son nom pour qu’il soit')
    console.error('ajouté à la liste reconnue.')
  } else {
    console.error('Aucune variable de base n’est définie pour cette')
    console.error('cible de déploiement. Attention : sur Vercel, les')
    console.error('variables sont portées par environnement — une variable')
    console.error('posée pour « Production » n’est pas visible depuis un')
    console.error('déploiement « Preview ».')
    console.error('')
    console.error('Vercel : projet > Storage > Create Database, puis vérifiez')
    console.error('que la variable couvre bien Production ET Preview.')
  }
  console.error('')
  process.exit(1)
}

// Trace utile sans rien divulguer : on nomme la variable retenue, pas sa valeur.
console.error(`Connexion applicative : ${runtime.key}`)
console.error(`Connexion des migrations : ${migration.key}`)

// Une réparation silencieuse ferait chercher ailleurs si la connexion échoue
// malgré tout. On la dit, sans jamais montrer le caractère en cause : il
// appartient au mot de passe.
for (const entry of [runtime, migration]) {
  if (entry.repaired) {
    console.error(
      `${entry.key} : un caractère réservé du mot de passe a été encodé ` +
        'automatiquement. Le mot de passe transmis reste identique.',
    )
  }
}

// Contrôle de forme avant de laisser Prisma répondre « P1013 : the scheme is
// not recognized », message qui ne désigne jamais la cause réelle.
let invalid = false
for (const entry of [runtime, migration]) {
  const problem = describeConnectionProblem(entry.value)
  if (problem) {
    console.error('')
    console.error(`${entry.key} est mal formée : ${problem}`)
    invalid = true
  }
}

if (invalid) {
  console.error('')
  console.error('Dans Vercel, le champ Value ne doit contenir QUE l’URL :')
  console.error('  ni le préfixe « DATABASE_URL= », ni les guillemets.')
  console.error('Elle commence par postgresql:// et finit par /postgres.')
  console.error('')
  process.exit(1)
}

// N'avertir que sur un pooler en mode TRANSACTION : le mode session de
// Supabase (port 5432) gère les verrous consultatifs et convient aux
// migrations. Alerter sur le seul nom d'hôte crierait au loup.
if (blocksMigrations(migration.value)) {
  console.error(
    'Attention : les migrations passent par un pooler en mode transaction, ' +
      'qui ne gère pas les verrous consultatifs. Renseignez DIRECT_URL avec ' +
      'l’URL de connexion directe (port 5432 chez Supabase).',
  )
}

// Sortie standard : uniquement du shell évaluable.
//
// BUILD_DATABASE_URL vise le même hôte que DATABASE_URL, avec un pool taillé
// pour un processus long plutôt que pour une fonction serverless. Elle est
// appliquée aux seules étapes qui interrogent la base pendant le build ; la
// connexion applicative reste exportée telle quelle, pour que le log dise la
// vérité sur ce que l'application utilisera.
const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`
process.stdout.write(
  `export DATABASE_URL=${quote(runtime.value)}\n` +
    `export DIRECT_URL=${quote(migration.value)}\n` +
    `export BUILD_DATABASE_URL=${quote(withBuildParams(runtime.value))}\n`,
)
