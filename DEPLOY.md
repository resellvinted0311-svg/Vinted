# Déploiement sur Vercel

## 1. Pousser le code

L'archive livrée est un dépôt git complet : la branche et le remote sont déjà
configurés.

```bash
cd nina-diego
git push -u origin claude/secondhand-clothing-shop-kefiil
```

## 2. Créer la base de données

Le catalogue est en base : sans elle, le build échoue à la génération des
pages statiques. Dans le tableau de bord Vercel, projet → **Storage** →
**Create Database** → **Neon** (ou Supabase). Vercel injecte alors
`DATABASE_URL` automatiquement.

## 3. Variables d'environnement

Projet → **Settings** → **Environment Variables** :

**Une seule variable est nécessaire, et Vercel la pose lui-même** en créant la
base à l'étape 2 : `DATABASE_URL`. Tout le reste est déduit.

| Variable | Requise | Comportement par défaut |
|---|---|---|
| `DATABASE_URL` | oui | injectée par Vercel via Storage |
| `DIRECT_URL` | non | déduite : `POSTGRES_URL_NON_POOLING`, puis `DATABASE_URL_UNPOOLED`, puis `DATABASE_URL` |
| `SEED_ON_BUILD` | non | le jeu de démonstration est inséré si le catalogue est vide |
| `NEXT_PUBLIC_SITE_URL` | non | déduite de `VERCEL_PROJECT_PRODUCTION_URL` |
| `AUTH_SECRET` | non\* | sans elle, la connexion est désactivée proprement ; le reste fonctionne |

\* Sans `AUTH_SECRET`, la boutique est entièrement consultable mais personne ne
peut se connecter, et la page de connexion l'indique. Aucun secret de repli
n'est fabriqué : ce serait rendre les sessions falsifiables. Générez-la avec
`openssl rand -base64 32` dès que vous voulez tester les comptes.

Renseignez `DIRECT_URL` uniquement si les migrations échouent sur un verrou —
signe d'une connexion via un pooler en mode transaction. Le script vous en
avertit dans le log.

`SEED_ON_BUILD` reste disponible pour forcer (`1`) ou interdire (`0`) le seed.

Une fois le premier déploiement passé, **retire `SEED_ON_BUILD`**. Le seed est
idempotent, donc le relancer ne casse rien — mais il réécrirait les articles de
démonstration par-dessus un éventuel catalogue réel.

## 4. Ce que fait le build

`scripts/vercel-build.sh` enchaîne :

1. contrôle de `DATABASE_URL`, avec un message explicite si elle manque
2. déduction de `DIRECT_URL`
3. `prisma generate` — client typé
4. `prisma migrate deploy` — applique la migration initiale (tables,
   extensions `pg_trgm` et `unaccent`, trigger de recherche plein texte)
5. le seed, si `SEED_ON_BUILD=1`
6. `next build`

## 5. Comptes de démonstration

Créés uniquement par le seed :

| Rôle | Adresse | Mot de passe |
|---|---|---|
| Admin | `admin@nina-diego.test` | `AdminNinaDiego2026` |
| Client | `client@nina-diego.test` | `ClientNinaDiego2026` |

À supprimer avant toute mise en ligne réelle.

## 6. Ce qui n'est pas encore branché

Phases 2 à 8 non réalisées. En conséquence, sur le déploiement :

- « Ajouter au panier » et « Faire une offre » sont affichés mais **inactifs** ;
- aucun paiement, aucune expédition, aucune messagerie ;
- les textes de CGV, confidentialité et cookies sont des gabarits vides ;
- les mentions légales affichent un avertissement tant que les variables
  `LEGAL_*` ne sont pas renseignées — aucune valeur n'est inventée.

Ce qui fonctionne : l'accueil, le catalogue avec filtres et recherche, les
fiches articles avec mesures, les favoris, les 8 langues, la connexion.
