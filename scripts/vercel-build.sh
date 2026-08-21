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
DATABASE_URL="$BUILD_DATABASE_URL" next build
