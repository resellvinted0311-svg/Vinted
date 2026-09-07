#!/usr/bin/env sh
#
# Build de production Vercel.
#
# Enchaîne la génération du client Prisma, les migrations, le seed optionnel,
# puis le build Next. Écrit en shell plutôt qu'en une longue ligne de script
# npm pour pouvoir échouer avec des messages exploitables.

set -e

# ---------------------------------------------------------------------------
# Connexion à la base
# ---------------------------------------------------------------------------

# Les hébergeurs ne nomment pas la connexion de la même façon : DATABASE_URL,
# POSTGRES_PRISMA_URL, POSTGRES_URL selon l'intégration. Le résolveur accepte
# les alias connus et exporte DATABASE_URL et DIRECT_URL sous les noms
# qu'attend Prisma. Il diagnostique et échoue proprement s'il ne trouve rien.
#
# L'affectation est séparée de l'eval : `eval "$(cmd)"` renvoie le code de
# `eval`, pas celui de `cmd`, donc un échec du résolveur passerait inaperçu
# malgré `set -e`.
echo "→ Résolution de la connexion à la base"
DB_EXPORTS="$(tsx scripts/resolve-db-env.mjs)" || exit 1
eval "$DB_EXPORTS"

# ---------------------------------------------------------------------------
# Étapes
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Variables exigées en production
# ---------------------------------------------------------------------------

# `trustHost: true` est actif : Auth.js accepte alors l'en-tête Host de la
# requête pour construire ses URL de rappel. Vercel normalise cet en-tête, donc
# le vecteur est fermé — TANT QUE `AUTH_URL` est renseignée, ce qui la rend
# décisive et non facultative.
#
# Le risque n'est pas une attaque : c'est une DÉRIVE DE CONFIGURATION. Rien
# n'exigeait cette variable, donc rien ne garantissait qu'un futur
# environnement la poserait. On échoue ici plutôt que de le découvrir sur un
# lien de connexion qui pointe ailleurs.
if [ "$VERCEL_ENV" = "production" ] && [ -z "$AUTH_URL" ] && [ -z "$NEXTAUTH_URL" ]; then
  echo "✗ AUTH_URL est requise en production (trustHost est actif)." >&2
  echo "  Posez-la dans les variables d'environnement Vercel, au domaine" >&2
  echo "  public exact de la boutique — https://exemple.fr, sans barre finale." >&2
  exit 1
fi

# La limitation de débit a besoin d'un compteur PARTAGÉ.
#
# Sans Upstash, elle retombe sur une `Map` en mémoire. Ce repli est correct en
# développement et trompeur en production : chaque instance serverless a la
# sienne, remise à zéro à chaque démarrage à froid. Le plafond réel devient
# « la limite multipliée par le nombre d'instances », sans borne — c'est-à-dire
# pas de plafond du tout sur la page de connexion.
#
# Le code émet bien un avertissement, une fois par processus, dans des journaux
# que personne ne lit à ce moment-là. On échoue donc ici, comme pour AUTH_URL,
# et pour la même raison : c'est une dérive de configuration, pas une attaque,
# et elle ne se voit pas depuis l'application qui tourne.
if [ "$VERCEL_ENV" = "production" ] && { [ -z "$UPSTASH_REDIS_REST_URL" ] || [ -z "$UPSTASH_REDIS_REST_TOKEN" ]; }; then
  echo "✗ UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN sont requises en production." >&2
  echo "  Sans elles, la limitation de débit est locale à chaque instance :" >&2
  echo "  connexion, inscription et lien de connexion ne sont plus bornés." >&2
  exit 1
fi

echo "→ Génération du client Prisma"
prisma generate

echo "→ Application des migrations"
prisma migrate deploy

# Le seed ne demande aucune variable : on regarde si le catalogue est vide.
# Un premier déploiement trouve une base fraîche et la peuple ; les suivants
# n'y touchent pas. SEED_ON_BUILD reste disponible pour forcer (1) ou
# interdire (0) explicitement.
# Les étapes qui interrogent réellement la base passent par
# BUILD_DATABASE_URL : même hôte, mais un pool dimensionné pour un processus
# long. Avec le connection_limit=1 de la connexion applicative, le prérendu
# des 115 pages met les requêtes en file sur une seule connexion et dépasse le
# délai du pool (Prisma P2024) — réglage juste en serverless, ruineux ici.
# Le seed ne s'exécute QUE sur demande explicite.
#
# Il se déclenchait auparavant dès qu'il trouvait un catalogue vide — ce qui
# est précisément l'état d'une base neuve. Résultat : le jeu de démonstration,
# comptes compris, a été inséré dans la base de PRODUCTION au premier
# déploiement, sans que personne ne l'ait demandé.
#
# Peupler une base de production est un acte volontaire. On le rend tel.
if [ "$SEED_ON_BUILD" = "1" ]; then
  echo "→ Seed demandé explicitement (SEED_ON_BUILD=1)"
  DATABASE_URL="$BUILD_DATABASE_URL" tsx prisma/seed.ts
else
  echo "→ Seed ignoré (poser SEED_ON_BUILD=1 pour l'exécuter)"
fi

echo "→ Build Next.js"

# ---------------------------------------------------------------------------
# Le build, et la traduction de la seule panne qui s'est répétée
# ---------------------------------------------------------------------------
# « max clients reached in session mode » remonte du pooler au beau milieu du
# prérendu, sur une page de marques prise au hasard, et désigne la base alors
# que la base va très bien. Le message a coûté deux enquêtes complètes. On le
# traduit une fois pour toutes, ici, où il est lu.
#
# La sortie est à la fois DIFFUSÉE et CONSERVÉE, et le code de retour passe
# par un fichier. Deux règles du shell se liguent ici, et il faut les deux :
#
#  1. Dans un tuyau, `$?` est celui du DERNIER maillon — donc de `tee`, qui
#     réussit toujours. Ce projet s'est déjà fait prendre par cette règle, sur
#     un build annoncé vert alors qu'il venait d'échouer. Vérifié : après le
#     tuyau, `$?` vaut 0 quand la commande en tête sort en 7.
#
#  2. `set -e` est actif. Écrire le code sur la ligne SUIVANTE ne marche donc
#     pas : le groupe est tué dès l'échec, et l'écriture n'a jamais lieu — le
#     fichier reste vide et le test qui suit part en erreur de syntaxe.
#     Vérifié aussi, sous `sh` comme sous `dash`.
#
# D'où le `||` : il fait de la commande une commande TESTÉE, que `set -e`
# laisse passer, et `$?` y désigne bien le build. Fichier vide = succès.
JOURNAL="$(mktemp)"
CODE_FICHIER="$(mktemp)"

{
  DATABASE_URL="$BUILD_DATABASE_URL" next build 2>&1 || echo "$?" > "$CODE_FICHIER"
} | tee "$JOURNAL"

CODE="$(cat "$CODE_FICHIER")"

if [ -n "$CODE" ]; then
  if grep -q 'EMAXCONNSESSION\|max clients reached' "$JOURNAL"; then
    echo "" >&2
    echo "───────────────────────────────────────────────────────────────" >&2
    echo "Ce n'est pas une panne de la base : c'est un manque de PLACES." >&2
    echo "" >&2
    echo "Le pooler Supabase en mode session (port 5432) n'accepte que" >&2
    echo "quinze clients. Le build en demande quelques-unes — et le site" >&2
    echo "DÉJÀ EN LIGNE garde les siennes pendant toute la construction :" >&2
    echo "un déploiement ne remplace pas le site, il le double." >&2
    echo "" >&2
    echo "Deux leviers, dans lib/db/database-url.ts :" >&2
    echo "  - RESERVE_APPLICATION  : places laissées au site en service." >&2
    echo "    À relever si le trafic a grandi." >&2
    echo "  - BUILD_TOTAL_CONNECTIONS : ce que le build s'autorise." >&2
    echo "" >&2
    echo "Le remède durable est ailleurs : faire passer la connexion" >&2
    echo "applicative par le pooler en mode TRANSACTION (port 6543), qui" >&2
    echo "multiplexe et accepte bien plus de clients — en renseignant" >&2
    echo "alors DIRECT_URL avec la connexion directe, sans quoi les" >&2
    echo "migrations perdent leurs verrous consultatifs." >&2
    echo "───────────────────────────────────────────────────────────────" >&2
  fi
  exit "$CODE"
fi
