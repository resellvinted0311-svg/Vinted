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

Aucun compte n'est créé en production. En développement, le seed n'en crée que
si `SEED_ADMIN_PASSWORD` est renseignée, sans valeur de repli :

```bash
SEED_ADMIN_PASSWORD="…" pnpm db:seed
```

Adresses créées : `admin@nina-diego.test` (rôle ADMIN) et
`client@nina-diego.test`.

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
| `pnpm test:bench` | Banc d'essai du catalogue (base peuplée requise) |

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

### Structure de l'accueil — vitrine, pas rayon

L'accueil **n'ouvre pas** sur une grille filtrable. C'est la structure de tous
les sites de vêtements, et c'est précisément ce dont la boutique doit se
distinguer. Il ouvre sur une pièce, en grand, avec son relevé complet — ce
qu'une boutique où chaque article est unique peut montrer et qu'un catalogue de
tailles multiples ne peut pas.

La descente est une séquence : la pièce du moment, le bandeau de faits,
l'arrivage en rail horizontal, la méthode, l'index typographique, puis l'entrée
du catalogue. Celle-ci vit **en bas de page** : le rayon est une destination
qu'on choisit, pas la porte d'entrée.

### Direction artistique — « Registre »

Une pièce, un exemplaire : le site se tient comme un registre d'atelier plutôt
que comme une vitrine. Toile écrue chaude, contours pleins de 1,5 px, fiches à
angles adoucis (12 px), grotesque serrée en capitales pour les titres, chasse
fixe pour toute donnée — référence, matière, poids, mesures, dates.

L'écologie se démontre par la **traçabilité**, pas par le symbole : ce qui est
affiché d'une pièce, c'est ce qu'elle est. Aucun vert n'existe dans l'interface.

Trois gestes de mouvement, définis une seule fois dans `app/globals.css` :

| Classe | Effet | Où |
|---|---|---|
| `.ruled` / `.ruled-b` / `.ruled-t` | contour plein 1,5 px | fiches, cadres, sections |
| `.lift` | décalage 2 px + ombre pleine | boutons, pastilles, liens-boutons |
| `.card-pick` | rotation 0,5° + ombre pleine | vignette de catalogue |

`.lift` et `.card-pick` ne s'appliquent que sous `@media (hover: hover)` : sur
écran tactile, `:hover` reste collé après le tap.

Trois gestes de mouvement s'y ajoutent, dans `components/motion/` :

| Composant | Effet | Garde-fou |
|---|---|---|
| `Reveal` | apparition au défilement, une seule fois | rendu **visible** côté serveur ; le script escamote puis révèle. Sans JavaScript ou sans `IntersectionObserver`, rien n'est masqué |
| `PointerDrift` | dérive du visuel sous la souris | pointeurs fins uniquement, écriture cadencée par `requestAnimationFrame` |
| `Marquee` | bandeau défilant | CSS pur, aucun script ; le second exemplaire est `aria-hidden` |

`prefers-reduced-motion` neutralise les trois.

**Amendement au brief §11** (13/08/2026). Le brief interdisait toute imagerie
végétale. L'interdit est levé sur un point : la gravure au trait, à grande
échelle, sur les pages éditoriales uniquement — voir
`components/shop/engraving.tsx`, qui porte les conditions exactes. Elle ne
descend jamais dans un contrôle. Restent interdits les pictogrammes de
recyclage, les dégradés verts et les textures kraft.

### Rendu et cache

Les pages publiques restent prérendues : c'est ce qui porte le référencement
et la cible LCP. L'état de session est résolu côté client par `AccountNav`,
parce que lire les cookies dans le layout basculerait toutes les routes en
rendu dynamique. Les pages de compte sont explicitement dynamiques.

## Banc d'essai du catalogue

`pnpm test:bench` mesure listing, facettes et recherche. Il demande une base
peuplée ; pour reproduire les relevés (10 000 articles) :

```bash
createdb nina_bench
DATABASE_URL=…nina_bench pnpm db:deploy && DATABASE_URL=…nina_bench pnpm db:seed
# puis insérer des articles synthétiques (voir tests/bench/perf.bench.test.ts)
DATABASE_URL=…nina_bench pnpm test:bench
```

Relevé du 12/08/2026, 10 050 articles : page catalogue complète (listing +
6 dimensions de facettes) en 33 ms p50 / 41 ms p95. C'est ce qui a écarté la
vue matérialisée : sur un stock unitaire, des compteurs périmés coûtent plus
cher que 30 ms.
