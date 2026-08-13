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
if [ "$SEED_ON_BUILD" = "0" ]; then
  echo "→ Seed désactivé (SEED_ON_BUILD=0)"
elif [ "$SEED_ON_BUILD" = "1" ]; then
  echo "→ Seed forcé (SEED_ON_BUILD=1)"
  DATABASE_URL="$BUILD_DATABASE_URL" tsx prisma/seed.ts
elif DATABASE_URL="$BUILD_DATABASE_URL" node scripts/catalogue-is-empty.mjs; then
  echo "→ Catalogue vide : insertion du jeu de démonstration"
  DATABASE_URL="$BUILD_DATABASE_URL" tsx prisma/seed.ts
else
  echo "→ Catalogue déjà peuplé : seed ignoré"
fi

echo "→ Build Next.js"
DATABASE_URL="$BUILD_DATABASE_URL" next build
