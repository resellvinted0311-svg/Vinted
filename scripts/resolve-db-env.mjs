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
  presentDatabaseEnvNames,
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
const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`
process.stdout.write(
  `export DATABASE_URL=${quote(runtime.value)}\n` +
    `export DIRECT_URL=${quote(migration.value)}\n`,
)
