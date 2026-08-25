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
| `SEED_ON_BUILD` | non | **rien n'est inséré sans `SEED_ON_BUILD=1`**. Le seed se déclenchait auparavant sur un catalogue vide — l'état d'une base neuve — et a peuplé la production sans qu'on le demande |
| `NEXT_PUBLIC_SITE_URL` | non | déduite de `VERCEL_PROJECT_PRODUCTION_URL` |
| `AUTH_SECRET` | non\* | sans elle, la connexion est désactivée proprement ; le reste fonctionne |
| `AUTH_URL` | **oui** dès que `AUTH_SECRET` est posée | domaine public exact, sans barre finale. `trustHost` est actif : sans cette variable, Auth.js construit ses URL de rappel depuis l'en-tête Host de la requête. Le build de production échoue si elle manque |
| `UPSTASH_REDIS_REST_URL` | **oui en production** | sans elle, la limitation de débit est en mémoire : chaque instance a son propre compteur, remis à zéro à chaque démarrage à froid |
| `UPSTASH_REDIS_REST_TOKEN` | **oui en production** | idem |
| `CRON_SECRET` | **oui** | sans elle, la route `/api/cron` refuse tout et les réservations expirées ne sont jamais libérées |
| `SENTRY_DSN` | non, **recommandée** | sans elle, les incidents sont journalisés mais personne n'en est prévenu. Le transport est écrit à la main, sans dépendance : rien ne part qu'on n'ait mis soi-même — ni URL, ni en-tête, ni utilisateur (`lib/observability/sentry.ts`) |
| `LOG_LEVEL` | non | `info` par défaut. `debug` pour une enquête, à retirer ensuite : le volume est sans commune mesure |

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

**Ne posez `SEED_ON_BUILD=1` que si vous voulez réellement peupler la base de
démonstration**, et retirez-la juste après : le seed est idempotent, mais il
réécrirait les articles de démonstration par-dessus un catalogue réel.

## 4. Ce que fait le build

`scripts/vercel-build.sh` enchaîne :

1. contrôle de `DATABASE_URL`, avec un message explicite si elle manque
2. déduction de `DIRECT_URL`
3. `prisma generate` — client typé
4. `prisma migrate deploy` — applique la migration initiale (tables,
   extensions `pg_trgm` et `unaccent`, trigger de recherche plein texte)
5. le seed, **uniquement** si `SEED_ON_BUILD=1`
6. `next build`

## 5. Comptes de démonstration

Le seed ne crée AUCUN compte en production, et n'en crée en développement que
si `SEED_ADMIN_PASSWORD` est renseignée — sans valeur de repli.

```bash
SEED_ADMIN_PASSWORD="choisissez-un-mot-de-passe-long" pnpm db:seed
```

Les comptes créés sont alors `admin@nina-diego.test` et
`client@nina-diego.test`, tous deux avec ce mot de passe.

Aucun mot de passe n'est écrit dans ce dépôt : un secret committé finit
toujours par être publié avec le code.

## 6. Ce qui n'est pas encore branché

Phases 4 à 8 non réalisées. En conséquence, sur le déploiement :

- **le back-office couvre les offres et l'expédition** : accepter ou refuser
  une proposition se fait depuis `/admin/offres`, préparer, expédier et
  constater la livraison depuis `/admin/commandes`. Le reste — catalogue,
  réglages, retours — n'a pas d'écran ;
- **la contre-proposition n'est pas exposée**, et c'est délibéré : elle
  créerait une offre en attente au nom de l'acheteuse, qui ne pourrait ni
  l'accepter ni en déposer une autre — donc bloquée quarante-huit heures pour
  avoir négocié. Le raisonnement complet, et les deux points à traiter avec
  elle, sont en tête de `lib/admin/offer-actions.ts` ;
- **aucun transporteur n'est appelé** : les grilles de port sont en base, et le
  numéro de suivi est recopié à la main depuis le bordereau — la ligne
  `Shipment` est créée en `provider: 'manual'`. Aucune étiquette n'est achetée,
  aucun suivi n'est relevé automatiquement, et `DELIVERED` se pose à la main
  parce que rien ne peut le constater. Le jour où un transporteur sera branché,
  il recevra nom, adresse et téléphone — donc il devra entrer dans la liste des
  sous-traitants, avec son contrat (`docs/rgpd.md`) ;
- aucune messagerie, aucun retour, aucun avis ;
- la newsletter n'est pas branchée : `User.marketingConsent` est un simple
  booléen, et `NewsletterSubscriber` — qui porte la preuve du consentement et
  le jeton de désinscription **obligatoire** de l'article L34-5 du CPCE —
  attend une décision commerciale sur le double opt-in (`docs/rgpd.md`, §7.6) ;
- les textes de CGV, confidentialité et cookies sont des gabarits vides ;
- les mentions légales affichent un avertissement tant que les variables
  `LEGAL_*` ne sont pas renseignées — aucune valeur n'est inventée.

Ce qui fonctionne : l'accueil, le catalogue avec filtres et recherche, les
fiches articles avec mesures, les favoris, les 8 langues, la connexion, le
panier, le paiement Stripe avec factures et e-mails, la négociation (dépôt,
registre au compte, prix payable), la baisse automatique des prix, le suivi
d'expédition de la commande payée jusqu'à la livraison, et la synchronisation
avec l'application de gestion dans les deux sens.

## 7. Décisions laissées ouvertes, à trancher un jour

Elles ne bloquent pas la mise en service. Elles sont écrites ici pour ne pas
avoir à les redécouvrir.

### Le dépôt est PUBLIC, et c'est un choix

Ce n'est pas un problème de sécurité : aucun secret n'est dans le dépôt —
vérifié sur tout l'historique — et rien de ce qui protège la boutique ne
repose sur le fait que le code soit caché.

Le seul vrai inconvénient est **commercial** : `prisma/seed.ts` publie le
barème de baisse automatique (−10 % à 30 jours, −20 % à 60), l'offre minimale,
le plafond de tentatives et la carence. Un client qui les lit sait qu'il lui
suffit d'attendre, et jusqu'où descendre.

Deux façons de le régler, au choix :

1. passer le dépôt en privé — *Settings → Danger Zone → Change repository
   visibility*. Vercel, l'application GitHub et le déploiement continuent sans
   changement ; il n'y a aucun workflow Actions à refacturer ;
2. **ou** garder le dépôt ouvert et déplacer les vraies valeurs en base. Ces
   réglages vivent déjà dans la table `Setting` — le code ne fait que les lire,
   et le seed ne s'exécute en production que sur demande explicite
   (`SEED_ON_BUILD=1`). Changer le barème en base suffit à ce que le dépôt ne
   révèle plus rien de réel. C'est le geste naturel le jour où le back-office
   permettra de l'ajuster.

La seconde est préférable si le dépôt a une valeur de vitrine. La première est
plus simple. Ne rien faire est tenable tant que la boutique est confidentielle,
et cesse de l'être le jour où elle ne l'est plus.

### La CSP reste permissive sur le catalogue

La politique de sécurité de contenu est à deux niveaux :

| Pages | `script-src` | Ce que ça change |
| --- | --- | --- |
| Panier, tunnel, commandes, compte, connexion, inscription, favoris | nonce, **sans** `unsafe-inline` | Aucun script en ligne injecté ne s'exécute |
| Accueil, catalogue, fiches, pages statiques | `unsafe-inline` | Le second rideau manque |

Ce n'est pas un demi-travail, c'est une limite technique mesurée : un nonce
change à chaque requête, le HTML d'une page prérendue est figé au build. Les
deux sont incompatibles. Mesuré sur ce projet — `/fr` porte 39 scripts en ligne
dont 0 pourrait porter un nonce ; `/fr/panier` en porte 21, tous noncés.

Fermer le catalogue supposerait de le rendre dynamique, donc de perdre le
prérendu de 171 pages — la vitesse et le référencement — pour une défense en
second rideau. Le partage retenu donne la protection forte là où une injection
coûterait le plus, sans rien payer.

À rouvrir le jour où Next saura porter un nonce dans une page prérendue.
`tests/e2e/csp.spec.ts` vérifie les deux niveaux contre un vrai navigateur, y
compris qu'aucune page prérendue n'a basculé par erreur du côté strict — ce qui
la rendrait blanche.

### L'existence d'un compte est révélée à l'inscription

`signUpAction` répond « cette adresse est déjà prise » — donc dit si une
adresse a un compte. Les deux autres portes le ferment explicitement : la
connexion rend un message unique, le lien magique une réponse identique dans
tous les cas.

C'est **assumé, pas oublié**. Le fermer vraiment supposerait de rendre la
réponse identique dans les deux cas, donc de ne plus connecter la personne
immédiatement après l'inscription et d'attendre qu'elle relève un e-mail de
vérification. Sur une boutique de vêtements, l'information divulguée est de
faible sensibilité — sans commune mesure avec un service de santé ou de
rencontre — et le coût de conversion d'une vérification obligatoire est réel.

Le sondage de masse reste borné par la limitation à cinq inscriptions par heure
et par empreinte. À revoir si la boutique traite un jour des données plus
sensibles.

### Le numéro de suivi est conservé aussi longtemps que la commande

Une commande payée est une pièce comptable : dix ans, article L123-22 du code
de commerce. Le numéro de suivi qui l'accompagne, lui, n'en est **pas** une —
aucune mention obligatoire de facture ne le réclame. Il est pourtant conservé
aussi longtemps qu'elle, et effacé en même temps qu'elle
(`stripShipmentTracking`, dans `lib/privacy/anonymize.ts`).

Ce n'est pas idéal au regard de l'article 5.1.e : un numéro de suivi ouvre chez
le transporteur une page qui porte la destination du colis, et rien ne justifie
de garder cette clé pendant dix ans. Une durée propre, bien plus courte, serait
plus juste.

**Pourquoi elle n'a pas été fixée :** aucune des durées que le code connaît ne
la fonde. La prescription applicable à un litige de livraison, la fenêtre
pendant laquelle un transporteur accepte encore d'ouvrir une enquête, la durée
de la garantie légale sur un vêtement d'occasion — ce sont trois questions de
droit, et écrire un nombre au jugé donnerait à la déclaration publique un air
de rigueur qu'elle n'aurait pas. C'est exactement ce que `docs/rgpd.md`
reproche aux politiques de confidentialité rédigées à la main.

**Ce qu'il faut faire pour trancher :** demander la durée à un juriste, poser
une constante `SHIPMENT_TRACKING_RETENTION_DAYS` dans `lib/config/privacy.ts`,
la déclarer sur l'entrée `shipments` du registre, et appeler
`stripShipmentTracking` depuis la purge périodique avec sa propre échéance. Le
mécanisme est déjà écrit et testé : il ne manque que le nombre.
