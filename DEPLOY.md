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

## 4 bis. Le balayage périodique, et la limite du plan

`vercel.json` déclare **une exécution par jour** de `/api/cron`. Ce n'est pas le
rythme souhaitable : c'est le seul que tous les plans acceptent.

**Ce qui s'est réellement passé.** Ce fichier demandait `*/5 * * * *`. Sur un
plan Hobby, une cadence au-delà de la limite du plan fait **refuser le
déploiement avant le build** — pas échouer, refuser. Le symptôme est
déroutant : aucun build en erreur, aucun déploiement nouveau, et une intégration
Git qui semble pourtant connectée. La boutique est restée dix-sept jours sur le
commit précédant l'ajout de ce fichier sans que rien ne le signale.

**Ce qu'une cadence lente coûte, exactement.** Rien de faux, seulement du retard
de ménage. Aucune règle du domaine ne suppose que le balayage est passé : un
verrou de panier est jugé sur `reservedUntil > now`, une offre sur son échéance.
Ce qui traîne, ce sont les LIGNES, pas les décisions. Concrètement, une pièce
dont le panier est abandonné peut rester affichée « réservée » — donc invisible
à l'achat — jusqu'à vingt-quatre heures. Tolérable avant l'ouverture,
inacceptable ensuite.

**Retrouver les cinq minutes**, au choix :

- passer le projet en plan payant, et remettre `"schedule": "*/5 * * * *"` ;
- ou appeler `/api/cron` depuis un ordonnanceur extérieur, avec l'en-tête
  `Authorization: Bearer $CRON_SECRET`. La route ne demande rien d'autre, et le
  cron quotidien de Vercel reste alors un filet de sécurité.

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
- **la contre-proposition est exposée des deux côtés** : le vendeur l'émet
  depuis `/admin/offres`, l'acheteuse l'accepte ou la décline depuis
  `/compte/offres`. Elle n'est possible que sur une offre portée par un
  COMPTE — une invitée n'a aucun écran où y répondre, et lui en adresser une la
  bloquerait sur cette pièce jusqu'à l'échéance ;
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
registre au compte, prix payable, contre-proposition), la baisse automatique
des prix, le suivi
d'expédition de la commande payée jusqu'à la livraison, et la synchronisation
avec l'application de gestion dans les deux sens.

## 7. Décisions laissées ouvertes, à trancher un jour

Elles ne bloquent pas la mise en service. Elles sont écrites ici pour ne pas
avoir à les redécouvrir.

### Le dépôt est PUBLIC — et il ne dit plus rien de votre économie

Ce n'est pas un problème de sécurité : aucun secret n'est dans le dépôt —
vérifié sur tout l'historique — et rien de ce qui protège la boutique ne repose
sur le fait que le code soit caché.

C'était en revanche un problème **commercial**. `prisma/seed.ts` publiait la
marge minimale visée, la majoration appliquée au port, le barème de baisse dans
le temps, la grille de coûts transporteur et jusqu'aux lieux d'approvisionnement
des pièces de démonstration. Un audit du dépôt a recensé **208 valeurs
numériques, dont 25 révélatrices** au sens strict : elles disaient ce que la
boutique gagne, ce qu'elle achète, ou jusqu'où elle cède.

**Ce n'est plus le cas**, et par construction :

- tout ce qui pourrait ressembler à un chiffre d'affaires vit dans
  `prisma/seed-data/fixtures.ts`, sous un en-tête qui dit que ces nombres sont
  **faux**. La grille transporteur de `seed-data/shipping.ts` porte le même
  avertissement ;
- `lib/domain/pricing.ts` n'a **plus de configuration par défaut**. Un appelant
  qui n'en fournit pas ne compile plus, au lieu de calculer avec des chiffres
  que personne n'a choisis ;
- les vraies valeurs se saisissent dans **Admin → Réglages**, n'existent que
  dans la base de production, et se changent sans redéployer ;
- enregistrer cet écran fait passer `settingsProfile` à `production`. Tant qu'il
  vaut `development`, `getPricingConfig()` **refuse de calculer un prix** en
  production : impossible d'ouvrir la boutique sur les nombres de démonstration
  et de vendre à perte sans s'en apercevoir.

Deux points à garder en tête, malgré tout.

**L'historique.** Les valeurs d'origine sont dans le dépôt depuis le premier
commit ; les retirer aujourd'hui ne les retire pas des commits passés, et le
dépôt était public. Elles ont toujours été des repères, jamais des chiffres
réels — c'est ce qui rend l'affaire sans conséquence. La règle qui en découle
vaut pour la suite : **un nombre publié ne redevient pas secret, il ne peut que
cesser d'être vrai.** Ne posez donc vos vraies valeurs que dans l'écran de
réglages.

**Le passage en privé reste possible** — *Settings → Danger Zone → Change
repository visibility*. Vercel, l'application GitHub et le déploiement
continuent sans changement, et il n'y a aucun workflow Actions à refacturer. À
peser : sur un dépôt public, GitHub cherche gratuitement les identifiants qui
fuient et vous alerte ; sur un dépôt privé, c'est une option payante. Et les
forks éventuels **restent publics** — GitHub les détache dans un réseau séparé
au lieu de les supprimer. Vérifiez *Insights → Forks* avant de considérer
l'affaire close.

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

### La piste d'audit suit la durée de la commande qu'elle décrit

Même famille de question que le numéro de suivi, et même réponse provisoire.

`AuditLog` n'était purgée par rien. Elle l'est maintenant, à l'échéance
comptable — dix ans — parce que son unique événement (« des lignes de cette
commande payée n'ont pas pu être honorées, un remboursement est dû ») décrit une
vente : il n'a pas à survivre à la commande, ni à mourir avant elle. C'est une
durée **dérivée** de l'objet décrit, pas un chiffre choisi pour cette table.

Ce n'est pas idéal : une note d'exploitation n'est pas une pièce comptable. Une
durée propre, plus courte, se défendrait — la même question de droit que pour le
suivi, et la même raison de ne pas y répondre au jugé.

Le risque, lui, est fermé autrement : `lib/audit/trail.ts` est désormais le seul
chemin autorisé vers cette table, il n'accepte que des scalaires filtrés, et un
test refuse tout appel direct à `auditLog.create` ailleurs. Même si la durée
reste longue, ce qui est conservé ne peut plus être une copie de ligne `User`.

**Ce qu'il faut faire pour trancher :** demander la durée à un juriste, poser
une constante `SHIPMENT_TRACKING_RETENTION_DAYS` dans `lib/config/privacy.ts`,
la déclarer sur l'entrée `shipments` du registre, et appeler
`stripShipmentTracking` depuis la purge périodique avec sa propre échéance. Le
mécanisme est déjà écrit et testé : il ne manque que le nombre.
