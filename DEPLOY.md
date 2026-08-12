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

| Variable | Valeur | Rôle |
|---|---|---|
| `DATABASE_URL` | injectée par Vercel | connexion applicative |
| `DIRECT_URL` | même valeur que `DATABASE_URL` | migrations Prisma, sans pooler |
| `AUTH_SECRET` | `openssl rand -base64 32` | signature des sessions |
| `NEXT_PUBLIC_SITE_URL` | l'URL du déploiement | métadonnées, liens canoniques |
| `SEED_ON_BUILD` | `1` **au premier déploiement seulement** | insère les 50 articles de démonstration |

`DIRECT_URL` est indispensable : avec Neon comme avec Supabase, `DATABASE_URL`
passe par un pooler qui n'accepte pas les migrations.

Une fois le premier déploiement passé, **retire `SEED_ON_BUILD`**. Le seed est
idempotent, donc le relancer ne casse rien — mais il réécrirait les articles de
démonstration par-dessus un éventuel catalogue réel.

## 4. Ce que fait le build

Le script `vercel-build` enchaîne :

1. `prisma generate` — client typé
2. `prisma migrate deploy` — applique la migration initiale (tables,
   extensions `pg_trgm` et `unaccent`, trigger de recherche plein texte)
3. le seed, si `SEED_ON_BUILD=1`
4. `next build`

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
