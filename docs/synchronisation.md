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

**Panier et paiement.** Le panier existe et fonctionne, côté serveur. **Le
paiement n'existe pas encore** — Stripe est le lot suivant. Aucune vente ne peut
donc avoir lieu aujourd'hui, et la remontée « vendu » n'aura rien à transporter
avant que ce lot soit livré.

---

## 1. Deux sens, deux mécaniques

| Sens | Qui appelle | Quand | Disponible |
|---|---|---|---|
| Inventaire | l'application | à chaque création ou modification d'une pièce | dès que l'endpoint est écrit |
| Vente | la boutique | à chaque vente, réservation ou baisse de prix | après le lot Stripe |

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
| `description` | chaîne | 1 à 5000. En français |
| `categorySlug` | chaîne | l'une des valeurs du §2.4 |
| `condition` | chaîne | `NEW_WITH_TAGS`, `NEW_WITHOUT_TAGS`, `VERY_GOOD`, `GOOD`, `FAIR` |
| `sizeLabel` | chaîne | libre — `M`, `W32 L34`, `42` |
| `priceCents` | entier | > 0. **En centimes**, jamais en euros décimaux |
| `costCents` | entier | ≥ 0. Prix d'achat, en centimes. Nécessaire au calcul du prix plancher |
| `weightGrams` | entier | 1 à 5000. Poids de la pièce seule, l'emballage est ajouté par la boutique |
| `images` | tableau d'URL | 1 à 10, en `https://`, accessibles publiquement |

**Sur le poids.** Au-delà de 5000 g, aucun tarif transporteur ne couvre le colis
et la boutique refuse de calculer un port plutôt que d'en inventer un. Une pièce
plus lourde est rejetée avec un message explicite.

**Sur le prix d'achat.** Il est indispensable : le prix plancher est calculé à
partir du coût, du port, des frais de paiement et de la marge minimale. Il ne
ressort **jamais** dans une réponse publique de la boutique.

### 2.3 Champs facultatifs

| Champ | Type | Contrainte |
|---|---|---|
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
jeans-pantalons     robes
vestes-legeres      manteaux
chaussures          accessoires        sacs
```

Refusées car parentes : `hauts`, `bas`, `vestes-manteaux`.

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
      "estimatedMarginCents": 820
    }
  ]
}
```

`action` vaut `created` ou `updated`.

**`belowFloor: true`** signifie que le prix envoyé passe sous le plancher
calculé. **La pièce est quand même publiée** — c'est une décision commerciale
qui appartient au vendeur — mais `estimatedMarginCents` dit la marge réelle, et
elle peut être négative. À afficher côté application.

En cas de rejet, le statut HTTP est 422 et chaque entrée porte son motif :

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

Motifs : `unknown-category`, `unknown-color`, `unknown-material`,
`unknown-fit`, `weight-not-covered`, `invalid-price`,
`compare-price-not-higher`, `image-unreachable`, `payload-too-large`.

Un lot est traité **article par article** : une pièce rejetée n'annule pas les
autres.

### 2.7 Images

La boutique **récupère** les URL fournies et les héberge elle-même. Elle
vérifie le type réel par les octets d'en-tête — pas par l'extension —, borne la
taille et les dimensions, et supprime les métadonnées EXIF, qui contiennent
souvent les coordonnées GPS du lieu de la photo.

Les URL doivent rester accessibles le temps de l'appel. Une image injoignable
rejette la pièce entière plutôt que de publier une fiche sans visuel.

### 2.8 Langues

L'application envoie du **français**. Les sept autres langues retombent dessus
jusqu'à ce que la traduction automatique soit branchée. Une cliente
néerlandaise verra donc du français en attendant — l'interface, elle, est bien
traduite.

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
