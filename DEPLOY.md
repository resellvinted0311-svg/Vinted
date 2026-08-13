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
**Create Database** → **Supabase**. Vercel pose alors les variables de
connexion lui-même, sans rien à recopier.

Supabase plutôt qu'un autre : le temps réel du panier et des offres
(Phases 2 et 3) s'appuie sur Supabase Realtime. Un autre hébergeur
imposerait de bâtir une couche SSE équivalente.

Supabase sert deux connexions sur le même hôte : le port **6543** en mode
transaction, pour l'application, et le port **5432** en mode session, pour les
migrations. Le build choisit la bonne tout seul.

## 3. Variables d'environnement

Projet → **Settings** → **Environment Variables** :

**Aucune variable n'est à saisir** : il suffit que la base existe. Vercel pose
lui-même la connexion en créant la base à l'étape 2, et le build accepte les
différentes conventions de nommage.

Un mot de passe contenant `@`, `#`, `?` ou `:` est encodé automatiquement au
passage : ces caractères rendent l'URL ambiguë, mais un nom d'hôte ne pouvant
pas en contenir, la réparation est sans ambiguïté et sans perte. Le log le
signale. Seul le `/` reste irrécupérable — il est indiscernable du séparateur
qui ouvre le nom de la base ; dans ce cas, changez le mot de passe.

| Variable | Requise | Comportement par défaut |
|---|---|---|
| connexion PostgreSQL | oui | reconnue sous `DATABASE_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL` ou `NEON_DATABASE_URL` |
| `DIRECT_URL` | non | déduite : `POSTGRES_URL_NON_POOLING`, puis `DATABASE_URL_UNPOOLED`, puis `DATABASE_URL` |
| `SEED_ON_BUILD` | non | le jeu de démonstration est inséré si le catalogue est vide |
| `NEXT_PUBLIC_SITE_URL` | non | déduite de `VERCEL_PROJECT_PRODUCTION_URL` |
| `AUTH_SECRET` | non\* | sans elle, la connexion est désactivée proprement ; le reste fonctionne |

\* Sans `AUTH_SECRET`, la boutique est entièrement consultable — catalogue,
recherche, favoris — mais **connexion et inscription sont refusées**, et les
deux pages le disent. Aucun compte n'est écrit en base dans ce cas : un compte
à moitié créé condamnerait l'adresse e-mail pour toujours. Aucun secret de
repli n'est fabriqué non plus, ce serait rendre les sessions falsifiables.

Pour activer les comptes, une seule variable suffit :

```bash
openssl rand -base64 32
```

Collez le résultat dans `AUTH_SECRET` (Production **et** Preview), puis
redéployez.

Renseignez `DIRECT_URL` uniquement si les migrations échouent sur un verrou —
signe d'une connexion via un pooler en mode transaction. Le script vous en
avertit dans le log.

**Attention aux environnements Vercel** : les variables sont portées par cible
(Production, Preview, Development). Une variable posée pour Production seule
n'est pas visible depuis un déploiement de branche, qui est un Preview. Si le
build annonce n'avoir trouvé aucune connexion, c'est la première chose à
vérifier — le log liste alors les noms des variables réellement présentes.

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
