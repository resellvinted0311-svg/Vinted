# Contrat de synchronisation — application de gestion ↔ boutique

Document de référence entre deux dépôts qui ne se voient pas. Chaque côté
l'implémente sans lire le code de l'autre.

- **Application de gestion** (`mathishannebique111-hash/resell`) — source de
  vérité de l'inventaire.
- **Boutique** (`resellvinted0311-svg/Vinted`) — vitrine et vente.

---

## 0. Ce qu'est la boutique, en trois réponses

**Avec quoi elle est faite.** Next.js 15 (App Router, composants serveur),
TypeScript strict sans `any`, Prisma 6, PostgreSQL. Auth.js v5 avec sessions en
base, next-intl pour huit langues, Tailwind v4. Déployée sur Vercel, base sur
Supabase.

**A-t-elle une base de données.** Oui. 38 tables, schéma complet du catalogue à
la commande : articles, traductions, images, mesures, catégories, marques,
offres, panier, commandes, expéditions, retours, zones et tarifs de port.

**Panier et paiement.** Les deux existent et fonctionnent. Panier serveur,
tunnel de commande, Stripe Checkout intégré, webhook signé, commande, facture
numérotée sans rupture et e-mails de confirmation : livrés.

---

## 0 bis. État de la livraison

| Élément | État |
|---|---|
| `POST /api/sync/articles` | **livré** — §2 ci-dessous fait foi, aux écarts près listés au §8 |
| Téléchargement des images | **livré** — file de travaux, cron toutes les 5 minutes |
| Remontée des ventes vers l'application | **à faire** |
| `GET /api/sync/changes` | **à faire** |

Le §8, en fin de document, liste les points sur lesquels l'implémentation
s'écarte de ce que les sections précédentes annonçaient, et pourquoi. Il est
court, mais il fait foi contre elles.

---

## 1. Deux sens, deux mécaniques

| Sens | Qui appelle | Quand | Disponible |
|---|---|---|---|
| Inventaire | l'application | à chaque création ou modification d'une pièce | **oui** |
| Vente | la boutique | à chaque vente, réservation ou baisse de prix | pas encore |

---

## 2. Inventaire — l'application écrit dans la boutique

### 2.1 Route

```
POST https://<boutique>/api/sync/articles
Authorization: Bearer <SYNC_API_KEY>
Content-Type: application/json
```

Le secret est partagé, posé des deux côtés en variable d'environnement, et
comparé **à temps constant** côté boutique. Il ne transite jamais dans une URL
ni dans un journal.

Un lot est accepté : le corps peut contenir un article seul ou un tableau
d'au plus 100. C'est ce qui rend l'import initial praticable.

### 2.2 Corps — champs OBLIGATOIRES

| Champ | Type | Contrainte |
|---|---|---|
| `externalId` | chaîne | 1 à 64 caractères. **L'identifiant de la pièce dans l'application.** C'est lui qui fait qu'un second envoi met à jour au lieu de dupliquer |
| `title` | chaîne | 1 à 200. En français |
| `categorySlug` | chaîne | l'une des valeurs du §2.4 |
| `condition` | chaîne | `NEW_WITH_TAGS`, `NEW_WITHOUT_TAGS`, `VERY_GOOD`, `GOOD`, `FAIR`, `POOR` |
| `sizeLabel` | chaîne | libre — `M`, `W32 L34`, `42` |
| `priceCents` | entier | > 0. **En centimes**, jamais en euros décimaux |
| `costCents` | entier | ≥ 0. Prix d'achat, en centimes. Nécessaire au calcul du prix plancher |
| `weightGrams` | entier | > 0. Poids de la pièce SEULE, l'emballage est ajouté par la boutique |
| `images` | tableau d'URL | 1 à 10, en `https://`, sur un nom de domaine, accessibles publiquement |

**Sur le poids.** La borne n'est pas un nombre écrit dans le code : c'est le
palier le plus lourd RÉELLEMENT tarifé, **emballage compris**. Aujourd'hui,
5000 g de palier et 80 g d'emballage, donc 4920 g de pièce — et ces deux
valeurs se règlent en back-office.

Vérifier le poids nu laisserait passer une pièce de 4980 g qui, une fois
emballée, ne trouverait aucun tarif : le refus tomberait à l'étape du paiement,
devant l'acheteuse, au lieu de tomber ici. Le message de refus cite le poids du
colis, la part d'emballage et le palier, pour qu'on n'ait pas à deviner.

**Sur les adresses d'images.** `https` obligatoire, et un NOM DE DOMAINE : une
adresse IP littérale est refusée. Le nom est ensuite résolu au moment du
téléchargement, et une pièce dont une seule adresse est privée, locale ou de
métadonnées d'instance est refusée. Les redirections ne sont pas suivies —
fournissez l'URL finale.

**Sur le prix d'achat.** Il est indispensable : le prix plancher est calculé à
partir du coût, du port, des frais de paiement et de la marge minimale. Il ne
ressort **jamais** dans une réponse publique de la boutique.

### 2.3 Champs facultatifs

| Champ | Type | Contrainte |
|---|---|---|
| `description` | chaîne | 1 à 5000, en français. **Facultative** : à défaut, la boutique compose un texte factuel à partir de la marque, de la taille, de l'état, de la matière et des mesures |
| `brandName` | chaîne | marque inconnue = créée |
| `comparePriceCents` | entier | prix barré. Doit être **strictement supérieur** à `priceCents`, sinon rejeté — un prix de référence fictif est une pratique commerciale trompeuse |
| `color` | chaîne | `ecru`, `marine`, `kaki`, `noir`, `bordeaux`, `gris`, `camel` |
| `material` | chaîne | `coton`, `laine`, `lin`, `denim`, `cuir`, `velours` |
| `fit` | chaîne | `droite`, `ajustee`, `ample`, `oversize` |
| `measurements` | objet | clés parmi `shoulders`, `chest`, `waist`, `hips`, `length`, `sleeve`, `inseam`, `footLength`. Valeurs en **centimètres** |
| `status` | chaîne | `AVAILABLE` (défaut) ou `ARCHIVED` pour retirer de la vente |

Une valeur hors liste pour `color`, `material` ou `fit` est **rejetée**, pas
ignorée : ces valeurs sont traduites en huit langues, une valeur inconnue
n'aurait pas de libellé.

### 2.4 Catégories acceptées

Seules les **feuilles** — une pièce ne se range jamais dans une catégorie
parente.

```
t-shirts            chemises           pulls-sweats
jeans-pantalons     jupes              shorts
robes               combinaisons
vestes-legeres      manteaux
chaussures          accessoires        sacs
maillots-de-bain    lingerie-nuit
```

Refusées car parentes : `hauts`, `bas`, `vestes-manteaux`.

`jupes`, `shorts`, `maillots-de-bain`, `lingerie-nuit` et `combinaisons` ont été
ajoutées après la première lecture du contrat : sept familles du stock n'avaient
aucune feuille, et les ranger de force ailleurs aurait faussé le filtrage.
`shorts` couvre aussi les bermudas, `lingerie-nuit` couvre pyjamas,
sous-vêtements et nuisettes.

La catégorie `Autre` de l'application n'a **pas** d'équivalent, volontairement :
une pièce qu'aucun mot-clé ne sait classer n'a rien à faire dans un catalogue
filtrable. Ces articles sont retenus côté application.

### 2.5 Ce que l'application n'envoie JAMAIS

`slug`, `sku`, `floorPriceCents`, `priceSource`, et les statuts `SOLD` ou
`RESERVED`. La boutique les possède : l'adresse publique, le numéro
d'inventaire, le plancher calculé, et surtout l'état de vente — qui dépend d'un
paiement encaissé, pas d'une déclaration.

### 2.6 Réponse

```json
{
  "ok": true,
  "results": [
    {
      "externalId": "abc-123",
      "action": "created",
      "sku": "ART-000051",
      "slug": "chemise-ralph-lauren-l-51",
      "url": "https://<boutique>/fr/a/chemise-ralph-lauren-l-51",
      "floorPriceCents": 2340,
      "belowFloor": false,
      "estimatedMarginCents": 820,
      "imagesPending": true,
      "published": false
    }
  ]
}
```

`action` vaut `created` ou `updated`.

`imagesPending` dit que les visuels ne sont pas encore stockés ; `published`
dit si la fiche est visible du public à cet instant. À la création, les deux
valent respectivement `true` et `false` : c'est normal, et la fiche se publie
seule quelques minutes plus tard.

**`belowFloor: true`** signifie que le prix envoyé passe sous le plancher
calculé. **La pièce est quand même publiée** — c'est une décision commerciale
qui appartient au vendeur — mais `estimatedMarginCents` dit la marge réelle, et
elle peut être négative. À afficher côté application.

Statut HTTP, selon l'issue du lot (voir §7.5) : `200` tout accepté,
**`207 Multi-Status`** lot mixte, `422` tout rejeté. Chaque entrée porte son
motif :

```json
{
  "ok": false,
  "results": [
    { "externalId": "abc-124", "action": "rejected",
      "reason": "weight-not-covered",
      "detail": "6200 g dépasse le palier le plus lourd (5000 g)" }
  ]
}
```

Motifs par article : `unknown-category`, `unknown-color`, `unknown-material`,
`unknown-fit`, `weight-not-covered`, `invalid-price`,
`compare-price-not-higher`, `locked-by-checkout`, `already-sold`,
`invalid-field`.

Deux ajouts par rapport à la première version de ce document, et ils sont
délibérés :

- **`already-sold`** — toute écriture sur une pièce vendue est refusée, pas
  seulement son archivage. Son prix et son libellé figurent, figés, sur une
  facture qu'une cliente détient ; réécrire la fiche publique ferait diverger
  les deux, et un litige se jugerait sur deux versions du même article ;
- **`invalid-field`** — tout ce qui n'a pas de motif dédié : titre vide,
  `externalId` trop long, clé inconnue. Écraser ces cas dans un motif
  approchant — `invalid-price` pour un titre vide — ferait chercher longtemps.

**`payload-too-large` n'est PAS un motif par article** : c'est un `400` global,
avec le motif en tête de réponse et `results: []`. Un lot de 120 pièces n'est
pas une collection de pièces invalides, c'est un lot mal découpé ; répondre 120
refus identiques ferait chercher l'erreur dans les données.

Un lot est traité **article par article** : une pièce rejetée n'annule pas les
autres.

**Toute clé inconnue est refusée**, elle n'est pas ignorée. Le cas qui a décidé
de la règle : `colour` au lieu de `color`. Ignorer publierait la pièce SANS sa
couleur, invisible dans la facette « couleur », et personne ne l'apprendrait
jamais. Corollaire assumé : le jour où l'application enverra un champ nouveau,
la boutique refusera jusqu'à ce que les deux côtés soient d'accord — c'est le
comportement voulu d'un contrat.

### 2.7 Images

La boutique **télécharge et réhéberge** les URL fournies. Elle vérifie le type
réel sur les octets d'en-tête — pas sur l'extension —, borne taille et
dimensions, et supprime les métadonnées EXIF, qui contiennent souvent les
coordonnées GPS du lieu de la photo.

Limites : 10 Mo, 6000 × 6000 pixels au maximum, **800 pixels minimum sur le
grand côté**. Formats : JPEG, PNG, WebP, AVIF.

**Le téléchargement est asynchrone** — voir §6, décision 2.5. Trois cents
images dans un seul appel dépasseraient le temps imparti à une fonction
serverless. L'article est donc créé immédiatement en brouillon, la réponse porte
`imagesPending: true`, et la fiche se publie seule dès que les images sont
stockées. Une fiche n'est jamais publiée sans visuel.

### 2.8 Langues

L'application envoie du **français**. Les sept autres langues retombent dessus
jusqu'à ce que la traduction automatique soit branchée. Une cliente
néerlandaise verra donc un TITRE français en attendant — l'interface, elle, est
bien traduite.

Trois précisions que l'implémentation a rendues nécessaires :

1. **Les huit lignes de traduction sont écrites d'emblée.** Le listing du
   catalogue joint les traductions en `INNER JOIN` sur la langue demandée : une
   pièce qui n'aurait qu'une ligne `fr` ne serait pas mal traduite, elle serait
   **absente** des sept autres catalogues.

2. **La fiche le dit.** Les sept lignes non françaises portent un drapeau, et la
   page affiche « cette fiche n'est pas encore traduite ». Elle n'affiche pas
   « traduite automatiquement » : ce serait faux, et une fausse mention use la
   confiance dans toutes les autres.

3. **La description composée, elle, est bien traduite.** Quand vous n'en
   fournissez pas, le relevé est assemblé à partir de libellés déjà traduits
   huit fois — matière, coupe, couleur, état, clés de mesure. Une cliente
   néerlandaise lit donc un titre français et un relevé néerlandais, et le
   vecteur de recherche néerlandais contient de vrais mots néerlandais.

---

## 3. Vente — la boutique appelle l'application

Disponible **après le lot Stripe**.

### 3.1 Route

L'application expose un point d'entrée, dont l'URL est configurée côté
boutique :

```
POST https://<application>/api/webhooks/boutique
X-ND-Timestamp: 1755168000
X-ND-Signature: sha256=<hmac>
Content-Type: application/json
```

### 3.2 Signature

`HMAC-SHA256` d'un secret partagé, calculé sur `<timestamp>.<corps brut>`.

Trois exigences côté application, et elles ne sont pas décoratives :

1. vérifier la signature sur le **corps brut**, avant tout décodage JSON —
   décoder d'abord, c'est signer autre chose que ce qui a été signé ;
2. comparer **à temps constant** ;
3. rejeter un horodatage vieux de plus de cinq minutes, sinon un appel
   intercepté peut être rejoué indéfiniment.

### 3.3 Corps

```json
{
  "event": "article.sold",
  "externalId": "abc-123",
  "sku": "ART-000051",
  "occurredAt": "2026-08-14T10:32:11.000Z",
  "sale": {
    "priceCents": 3800,
    "shippingPaidCents": 0,
    "paymentFeeCents": 82,
    "netCents": 3718
  }
}
```

Événements : `article.sold`, `article.reserved`, `article.released`,
`article.price_dropped`.

`netCents` est ce qui reste après les frais de paiement — la **marge réelle**,
que l'application ne peut pas calculer seule puisqu'elle ignore le port
effectivement payé et la commission prélevée.

### 3.4 Aucune donnée personnelle

Le corps ne contient **ni nom, ni adresse e-mail, ni adresse postale, ni
identifiant d'acheteur**. C'est une exigence du RGPD, pas une préférence : une
application de suivi d'inventaire n'a pas besoin de savoir *qui* a acheté pour
savoir *qu'une pièce est partie et à quel prix*. Transmettre plus ferait de
l'application un destinataire de données personnelles, à déclarer, à sécuriser
et à faire figurer dans la politique de confidentialité.

### 3.5 Réémission

La boutique réessaie sur échec ou absence de réponse, avec des délais
croissants : 1 min, 5 min, 30 min, 2 h, 6 h. L'application doit donc être
**idempotente** — le même `externalId` avec le même `event` et le même
`occurredAt` ne doit produire qu'un seul effet.

Une réponse `2xx` vaut acquittement. Tout le reste déclenche une réémission.

### 3.6 Filet de rattrapage

Si l'application a été indisponible longtemps :

```
GET https://<boutique>/api/sync/changes?since=2026-08-01T00:00:00Z
Authorization: Bearer <SYNC_API_KEY>
```

Renvoie tous les changements d'état depuis cette date. Rien ne se perd, même si
l'application reste éteinte une semaine.

---

## 4. Secrets

| Variable | Où | Rôle |
|---|---|---|
| `SYNC_API_KEY` | les deux | l'application s'authentifie auprès de la boutique |
| `SYNC_WEBHOOK_SECRET` | les deux | la boutique signe ses appels vers l'application |
| `SYNC_WEBHOOK_URL` | boutique | où joindre l'application |

Générer chacun avec `openssl rand -base64 32`. Jamais dans le dépôt : le projet
a déjà connu un mot de passe publié avec son code, et il a fini par être créé en
production.

---

## 5. Ordre d'implémentation

1. La boutique livre `POST /api/sync/articles`, et fournit `SYNC_API_KEY`.
2. L'application pousse son inventaire existant. On vérifie le catalogue.
3. L'application pousse à chaque création ou modification.
4. La boutique livre Stripe et la commande.
5. La boutique appelle l'application à chaque vente.
6. Le rattrapage `GET /api/sync/changes` ferme la boucle.

Les étapes 1 à 3 ne dépendent pas du paiement et peuvent avancer tout de suite.

---

## 6. Arbitrages — réponses aux sept questions

Numérotation de la réponse de l'application de gestion.

### 2.1 Catégories — cinq feuilles ajoutées

Fait, et en base. `jupes` et `shorts` sous `bas` ; `maillots-de-bain`,
`lingerie-nuit` et `combinaisons` à la racine, comme `robes`. Traduites dans les
huit langues, avec poids par défaut et clés de mesures.

Correspondance attendue :

| famille de l'application | feuille |
|---|---|
| Jupe | `jupes` |
| Short, Bermuda | `shorts` |
| Maillot de bain | `maillots-de-bain` |
| Pyjama, Sous-vêtement, Corset / Nuisette | `lingerie-nuit` |
| Combi / Combinaison | `combinaisons` |
| Autre | **ne pas envoyer** |

### 2.2 `POOR` ajouté

Fait, en base et traduit. Le refus de replier « mauvais état » sur `FAIR` était
juste : c'est le genre de raccourci qui finit en litige et en retour, pas en
vente.

### 2.3 Quantité — option (a), et c'est la seule possible

**Une commande ne peut pas porter deux exemplaires du même article, par
construction.** `CartItem` n'a pas de colonne quantité et porte une contrainte
d'unicité `(panier, article)` ; le verrou de stock fait passer un article entier
de « disponible » à « réservé » ; les données structurées annoncent un stock de
1. L'option (b) ne demanderait pas un champ mais la réécriture du panier, du
verrou, de la commande et du paiement.

Donc **(a)** : `<id>-1`, `<id>-2`, `<id>-3`, stables dans le temps.

Quand la quantité passe de 3 à 2, archivez **le plus haut numéro qui n'est ni
vendu ni réservé**. Si tous le sont, n'archivez rien : voir §2.7.

### 2.4 `description` devient facultative

Accepté. Seize heures de génération pour débloquer un import est un mauvais
échange.

À défaut, la boutique compose un texte factuel — marque, taille, état, matière,
mesures — et marque la fiche comme ayant une description générée. Un envoi
ultérieur avec une vraie description l'écrase.

### 2.5 Images

1. **Confirmé.** La boutique télécharge et réhéberge. Vos URL peuvent
   disparaître ensuite sans casser la fiche.

2. **Limites** : 10 Mo par image, 6000 × 6000 pixels au maximum, et **800 pixels
   minimum sur le grand côté** — en dessous, une photo de vêtement est
   inexploitable en fiche produit. Formats acceptés : JPEG, PNG, WebP, AVIF,
   vérifiés sur les octets d'en-tête et non sur l'extension.

3. **Le délai est un vrai problème, et je change le contrat pour lui.** Trois
   cents téléchargements dans un seul appel dépasseront le temps imparti à une
   fonction Vercel, en production, sur les gros lots.

   Les images ne sont donc **plus récupérées pendant l'appel**. L'article est
   créé immédiatement, en brouillon, et ses images sont téléchargées par la file
   de tâches déjà en place. La fiche est publiée automatiquement dès qu'elles
   sont stockées.

   La réponse porte `imagesPending: true` et `published: false`. Un article dont
   toutes les images échouent reste en brouillon et apparaît dans
   `GET /api/sync/changes` avec le motif — jamais publié sans visuel.

### 2.6 Poids — l'approche est la bonne

Poids par défaut par catégorie, volontairement majorés, poids réel prioritaire :
c'est exactement le bon arbitrage. Un poids sous-estimé coûte la différence de
port à chaque vente ; surestimé, il ne coûte que quelques centimes d'affichage.

Pour corriger au fil du temps, l'événement de vente portera de quoi réconcilier :

```json
"shipping": {
  "parcelWeightGrams": 780,
  "tierMaxGrams": 1000,
  "carrierCostCents": 480,
  "chargedCents": 0
}
```

`parcelWeightGrams` inclut l'emballage. Comparé à `tierMaxGrams`, il dit si la
pièce frôle une borne de palier — c'est là qu'une sous-estimation coûte cher.

### 2.7 Vendu sur Vinted pendant qu'il est dans un panier

La règle est déjà écrite et implémentée : **la boutique ne retire jamais une
ligne de panier en silence.** Trois cas :

- **article simplement dans des paniers** — l'archivage réussit. Les lignes
  passent à l'état « indisponible », restent visibles avec un message explicite,
  et seule la cliente peut les retirer ;
- **article `RESERVED`** — quelqu'un est à l'étape de paiement, carte en main.
  L'archivage est **refusé**, statut `409`, avec l'échéance du verrou dans la
  réponse. Réessayez après. Le verrou dure quinze minutes au maximum ;
- **article `SOLD`** — refusé. Il est déjà parti, et la boutique vous l'annonce
  par l'événement de vente.

Réponse d'un refus :

```json
{ "externalId": "abc-123", "action": "rejected",
  "reason": "locked-by-checkout",
  "lockedUntil": "2026-08-14T10:47:00.000Z" }
```

---

## 7. Réponses aux cinq demandes

### 7.1 Domaine

À confirmer : c'est l'URL de production Vercel de la boutique. Elle sera
communiquée avec les secrets.

### 7.2 Secrets

D'accord sur la méthode, et c'est la bonne : ils sont générés par le
propriétaire avec `openssl rand -base64 32` et posés directement dans les
variables d'environnement des deux projets Vercel. Ni dépôt, ni conversation.

### 7.3 Mode d'essai — accepté

`?dryRun=1` dans l'URL, ou `"dryRun": true` **à la racine de l'enveloppe** :

```json
{ "dryRun": true, "articles": [ … ] }
```

Pas à l'intérieur d'un article. Accepter une clé `dryRun` dans un objet article
mélangerait une commande et une donnée, et ouvrirait une brèche dans le refus
des clés inconnues. Un article seul ou un tableau nu n'ont donc que le paramètre
d'URL.

Valide tout, calcule le prix plancher, n'écrit rien. `action` vaut alors
`would-create` ou `would-update`.

**Une différence avec la réponse réelle, et une seule** : sur `would-create`,
`sku`, `slug` et `url` sont ABSENTS. Un essai à blanc ne consomme pas de numéro
d'inventaire ; en annoncer un serait pire qu'une absence, puisqu'il ne serait
pas celui attribué à l'écriture réelle. Sur `would-update`, ils sont présents —
la pièce existe déjà.

Demande justifiée : sans lui, vérifier une correspondance de champs oblige à
polluer un catalogue réel puis à nettoyer à la main.

### 7.4 Cadence

**30 appels par minute**, largement au-dessus des 20 lots de l'import initial.
Vous pouvez les enchaîner sans espacer.

La limite est comptée par clé et se **ferme** en cas de panne du compteur — la
route écrit dans le catalogue, elle est traitée comme un chemin sensible. Un
dépassement renvoie `429` avec `Retry-After`.

### 7.5 Statut HTTP d'un lot mixte — objection retenue

Vous avez raison, `422` global sur un lot partiellement accepté est trompeur.

| situation | statut |
|---|---|
| tout accepté | `200` |
| lot mixte | **`207 Multi-Status`** |
| tout rejeté | `422` |
| corps illisible, lot trop grand, lot vide | `400` |
| clé absente ou invalide | `401` |
| débit dépassé | `429` + `Retry-After` |

Le corps porte toujours le détail par article. Un `207` signifie « regardez le
détail », jamais « tout a échoué ».

Un `401` est renvoyé, et non un `404` : de votre côté, il faut pouvoir
distinguer une clé fausse d'une URL fausse.

---

## 8. Écarts entre ce document et ce qui est livré

Les sections précédentes ont été écrites avant l'implémentation. Là où
l'écriture du code a montré qu'elles étaient imprécises ou fausses, elles ont
été corrigées sur place ; ce qui suit récapitule les points sur lesquels un
lecteur de la version initiale se tromperait.

1. **Le poids ne se borne pas à 5000 g.** La borne est le palier le plus lourd
   réellement tarifé, **emballage compris**, et les deux valeurs sont des
   réglages. Voir §2.2.

2. **`payload-too-large` est un `400` global**, pas un motif par article. Voir
   §2.6.

3. **Deux motifs de refus s'ajoutent** : `already-sold` et `invalid-field`.
   Voir §2.6.

4. **Toute clé inconnue est refusée.** Voir §2.6.

5. **`dryRun` se met à la racine de l'enveloppe ou dans l'URL**, jamais dans un
   objet article ; et `would-create` ne porte ni `sku`, ni `slug`, ni `url`.
   Voir §7.3.

6. **Les huit lignes de traduction sont écrites d'emblée**, et la fiche annonce
   qu'elle n'est pas traduite. Voir §2.8.

7. **Une pièce archivée puis remise en vente** est publiée à ce moment-là, et
   c'est sa date de mise en ligne. Elle ne peut pas l'avoir été plus tôt : elle
   n'a jamais été visible.

8. **Ce que la boutique attribue et ne rend jamais** : `sku` suit une
   numérotation `ART-000051` continue ; `slug` est composé à la CRÉATION, à
   partir de la catégorie, de la marque, de la taille et du numéro
   d'inventaire, et **ne change plus jamais** — un titre corrigé ne déplace pas
   l'adresse d'une page indexée.

### 8.1 Ce qu'il faut savoir côté exploitation

- **Les images arrivent par le cron.** Une pièce créée est publiée au passage
  suivant de la tâche planifiée, pas dans la seconde. En cas d'échec, cinq
  reprises espacées, puis abandon — et la fiche reste en brouillon.

- **`SYNC_API_KEY` absente ferme la route entièrement.** Aucun mode dégradé,
  aucune ouverture par défaut.

- **Sans hébergement d'images configuré, rien n'est publié.** Le travail échoue
  bruyamment plutôt que d'écrire vos URL d'origine dans la fiche : une fiche
  dont les visuels dépendent d'un tiers deviendrait vide sans que personne
  l'apprenne, ce qui est exactement ce que le réhébergement existe pour éviter.

- **Renvoyer deux fois le même lot ne coûte presque rien.** Les visuels ne sont
  retéléchargés que si la liste d'URL a changé — la boutique conserve l'URL
  d'origine de chaque image pour pouvoir le savoir.
