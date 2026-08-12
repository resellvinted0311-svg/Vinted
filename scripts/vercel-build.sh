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

if [ -z "$DATABASE_URL" ]; then
  echo ""
  echo "DATABASE_URL n'est pas définie."
  echo ""
  echo "Le catalogue vit en base : sans elle, la génération des pages"
  echo "statiques échoue. Dans Vercel : projet > Storage > Create Database,"
  echo "ou renseignez la variable à la main dans Settings > Environment"
  echo "Variables."
  echo ""
  exit 1
fi

# `prisma migrate deploy` a besoin d'une connexion DIRECTE. Les hébergeurs
# exposent en général DATABASE_URL derrière un pooler en mode transaction,
# qui ne gère pas les verrous consultatifs utilisés par les migrations.
#
# On retient donc, dans l'ordre : la valeur explicite, puis les conventions
# de Neon et de Vercel Postgres, et en dernier recours DATABASE_URL elle-même.
# Cela évite d'imposer une variable manuelle de plus — l'oublier faisait
# échouer le build sur une erreur peu parlante.
DIRECT_URL="${DIRECT_URL:-${POSTGRES_URL_NON_POOLING:-${DATABASE_URL_UNPOOLED:-$DATABASE_URL}}}"
export DIRECT_URL

case "$DIRECT_URL" in
  *-pooler*|*pgbouncer=true*)
    echo "Attention : la connexion utilisée pour les migrations passe par un"
    echo "pooler. Si 'migrate deploy' échoue sur un verrou, renseignez"
    echo "DIRECT_URL avec l'URL de connexion directe."
    ;;
esac

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
if [ "$SEED_ON_BUILD" = "0" ]; then
  echo "→ Seed désactivé (SEED_ON_BUILD=0)"
elif [ "$SEED_ON_BUILD" = "1" ]; then
  echo "→ Seed forcé (SEED_ON_BUILD=1)"
  tsx prisma/seed.ts
elif node scripts/catalogue-is-empty.mjs; then
  echo "→ Catalogue vide : insertion du jeu de démonstration"
  tsx prisma/seed.ts
else
  echo "→ Catalogue déjà peuplé : seed ignoré"
fi

echo "→ Build Next.js"
next build
