# Nina & Diego

Boutique en ligne de vêtements de seconde main. Mono-vendeur, stock unitaire,
paiement direct, huit langues européennes.

## Démarrage

```bash
pnpm install
cp .env.example .env          # renseigner DATABASE_URL et AUTH_SECRET
pnpm db:deploy                # applique les migrations
pnpm db:seed                  # jeu de données de test
pnpm dev
```

`AUTH_SECRET` se génère avec `openssl rand -base64 32`.

### Base de données

PostgreSQL 16 minimum. Les extensions `pg_trgm` et `unaccent` sont créées par
la migration initiale.

- **Développement** : PostgreSQL local.
- **Production** : Supabase. Renseigner `DIRECT_URL` avec la connexion
  directe (sans pgbouncer), sinon `prisma migrate` échoue.

### Comptes de test

| Rôle | Adresse | Mot de passe |
|---|---|---|
| Admin | `admin@nina-diego.test` | `AdminNinaDiego2026` |
| Client | `client@nina-diego.test` | `ClientNinaDiego2026` |

Ces comptes ne sont créés que par le seed de développement.

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | Serveur de développement |
| `pnpm build` | Build de production |
| `pnpm typecheck` | Contrôle de types strict |
| `pnpm lint` | ESLint |
| `pnpm test` | Tests unitaires et d'intégration (Vitest) |
| `pnpm test:e2e` | Tests de bout en bout (Playwright) |
| `pnpm db:migrate` | Nouvelle migration |
| `pnpm db:seed` | Seed — déterministe et idempotent |

## Architecture

```
/app        routes ; les Server Actions orchestrent seulement
/lib/domain logique métier pure, testable sans base ni HTTP
/lib/db     client Prisma et sélecteurs publics explicites
/lib/providers  abstractions expédition, paiement, e-mail, stockage, IA
/components/ui  primitives Radix restylées
/messages   traductions d'interface, 8 langues
/prisma     schéma, migrations, seed
/tests      unitaires (Vitest) et bout en bout (Playwright)
```

**Règle** : aucune logique métier dans un composant React. Les Server Actions
valident (Zod), appellent le domaine, persistent, répondent.

### Données privées

`costCents`, `floorPriceCents`, `internalNotes` et `sourcedFrom` ne sortent
jamais d'une réponse publique. Les lectures publiques passent par les
sélecteurs explicites de `lib/db/selectors.ts`, et un test balaie les charges
utiles à la recherche de ces champs.

### Rendu et cache

Les pages publiques restent prérendues : c'est ce qui porte le référencement
et la cible LCP. L'état de session est résolu côté client par `AccountNav`,
parce que lire les cookies dans le layout basculerait toutes les routes en
rendu dynamique. Les pages de compte sont explicitement dynamiques.
