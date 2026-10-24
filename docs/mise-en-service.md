# Mise en service — ce qui reste à faire, dans l'ordre

État au **24 octobre 2026**. Le panneau **Mise en service** en haut de
`/fr/admin` dit en direct ce qui manque encore, variable par variable. Quand il
n'affiche plus rien, la boutique peut vendre.

Ce fichier sert aussi de mémoire entre deux sessions de travail : on le relit
en début de session, on coche ce qui avance.

Règles qui valent pour chaque étape :

- une variable se pose dans **Vercel → projet → Settings → Environment
  Variables**, environnement **Production**, sans guillemets. Les clés en type
  « Secret ». **Jamais dans le dépôt, jamais dans une conversation** ;
- après chaque ajout ou changement de variable : **Deployments → dernier
  déploiement de Production → ⋯ → Redeploy**. Une variable ne s'applique qu'aux
  nouveaux déploiements ;
- un push sur `main` est une mise en production : il se fait sur accord
  explicite, à chaque fois.

## Déjà fait, et vérifié

- Le site est public : https://vinted-iota.vercel.app.
- 417 vraies pièces importées depuis SuiviVinted ; aucune pièce de
  démonstration en production.
- Tarifs de port réels 2026 (Colissimo, Mondial Relay), modifiables dans
  `/fr/admin/livraison`.
- Négociation éteinte (`OFFERS_ENABLED` absente), y compris dans les CGV.
- Une modification faite dans SuiviVinted n'efface jamais une photo ajoutée
  depuis la régie.
- Prêts dans le code, en attente des variables : identité légale d'une SAS
  (mentions légales, CGV, factures), coordonnées complètes du médiateur, bloc
  hébergeur, fonction de rétractation en ligne « Renoncer au contrat ici »
  (obligatoire depuis le 19 juin 2026), bouton « Commander avec obligation de
  paiement », CGV en version **2026-10** (plateforme européenne de litiges
  retirée, fermée le 20 juillet 2025 ; encadré réglementaire des garanties
  légales recopié de l'annexe de l'article D211-2 ; règle des biens
  d'occasion ; délai de remboursement).
- Rétractation en ligne : une déclaration faite avec une autre adresse que
  celle de la commande est gardée, et l'avis à la boutique le signale en
  majuscules. **Faire confirmer à l'adresse de la commande avant d'annuler ou
  de rembourser** : un tiers ne peut pas se rétracter à la place de
  l'acheteur. L'accusé part toujours vers l'adresse de la commande.

## Étape A — maintenant, sans attendre la société

### A1. Le nom de domaine

Il conditionne les e-mails : Resend refuse d'écrire aux clientes depuis une
adresse qui n'est pas sur un domaine que l'on possède, et `vercel.app` n'en est
pas un. L'adresse actuelle contient aussi « vinted », une marque déposée.

Disponibles le 24/10/2026 (vérifié au registre) :

| Domaine | Où l'acheter | Prix relevé |
|---|---|---|
| **`ninaetdiego.com`** — recommandé, le plus simple | Vercel | 11,25 $ par an, achat et renouvellement |
| `ninaetdiego.fr` | OVHcloud (Vercel ne vend pas le `.fr`) | 4,99 € HT la 1re année, puis 7,79 € HT par an |

Le `.com` acheté chez Vercel ne demande **aucun réglage DNS** : Vercel s'en
charge, et Resend s'y configure en un clic. Un `.fr` demande de recopier des
enregistrements chez OVH.

1. Vercel → **Domains** → **Buy** → `ninaetdiego.com`. Laisser le
   renouvellement automatique. Valider l'e-mail de confirmation du titulaire
   sous 15 jours, sinon le domaine est suspendu.
2. Projet → **Settings → Domains → Add Domain** → `ninaetdiego.com`. Accepter
   l'ajout de `www`. Le domaine **principal** est celui qui ne redirige pas.
3. Dans les variables, mettre le domaine principal, en `https://`, sans `/`
   final, dans **`NEXT_PUBLIC_SITE_URL`** et **`AUTH_URL`** (et dans
   `NEXTAUTH_URL` si elle existe). Redéployer.

### A2. L'adresse de la boutique

**`LEGAL_EMAIL`** : l'adresse où arrivent les avis « commande à préparer » et
« rétractation ». Elle est aussi publiée comme contact. Elle peut être posée
seule, dès maintenant. Vercel n'héberge aucune boîte mail : prendre une adresse
qui existe déjà.

### A3. Les e-mails — Resend, gratuit

3 000 e-mails par mois, 100 par jour.

1. Compte sur https://resend.com (directement, pas par la Marketplace Vercel).
2. **Domains → Add Domain** : un sous-domaine, par exemple
   `mail.ninaetdiego.com` ; région **eu-west-1** (Irlande).
3. **Auto Configure** (le domaine est chez Vercel), puis **Verify DNS
   Records**. Compter de quelques minutes à 72 h.
4. **API Keys → Create API Key**, permission **Sending access** → copier
   (affichée une seule fois) dans **`RESEND_API_KEY`**.
5. **`EMAIL_FROM`** = `Nina & Diego <bonjour@mail.ninaetdiego.com>`, sur le
   domaine vérifié. Redéployer.

Le panneau signale une adresse d'essai (`resend.dev`, `example.com`) : elle
n'écrit à personne.

### A4. Les photos — Cloudinary, gratuit

25 crédits par période de 30 jours ; une image de 10 Mo au plus.

1. Compte sur https://cloudinary.com.
2. **Dashboard** → « Cloud name » → **`CLOUDINARY_CLOUD_NAME`**.
3. **Settings → API Keys** → **`CLOUDINARY_API_KEY`** et
   **`CLOUDINARY_API_SECRET`**. Redéployer (le nom est lu au build).
4. Les photos s'ajoutent ensuite dans la régie : **Pièces → une pièce →
   Photos**. La première est la vignette. SuiviVinted n'a pas de colonne photo.

### A5. Le paiement en mode test — Stripe

1. Compte sur https://dashboard.stripe.com, ouvrir un **sandbox**.
2. **API keys** : `pk_test_…` → **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** ;
   `sk_test_…` → **`STRIPE_SECRET_KEY`**.
3. **Workbench → Webhooks → Create an event destination** : « Your account »,
   format **Snapshot** (pas « Thin »), version d'API **2026-07-29.dahlia**,
   événements **`checkout.session.completed`** et
   **`checkout.session.expired`**, URL
   `https://<domaine principal>/api/webhooks/stripe` — le domaine final, qui ne
   redirige pas (une redirection compte comme un échec chez Stripe).
4. **Reveal secret** → `whsec_…` → **`STRIPE_WEBHOOK_SECRET`**. Redéployer.
5. Le dire à Claude : une commande d'essai est passée de bout en bout avec la
   carte de test `4242 4242 4242 4242`.

### A6. La synchronisation instantanée

Le rattrapage de 3 h du matin est prouvé ; le webhook instantané ne l'est pas.
Changer le prix d'une pièce dans SuiviVinted, puis vérifier le site une minute
plus tard (ou donner le titre à Claude, qui vérifie).

## Étape B — dès que la SAS est immatriculée

### B1. Le médiateur de la consommation (obligatoire)

Recommandé : **CM2C** (Centre de Médiation de la Consommation des Conciliateurs
de justice), https://www.cm2c.net — référencé par la CECMC pour la vente en
ligne, l'habillement et les biens d'occasion. 48 € pour 3 ans, payés à
l'inscription ; 36 € par médiation à distance, dus seulement si la boutique
accepte d'entrer en médiation (https://www.cm2c.net/tarifs.php, relevé le
24/10/2026 ; HT ou TTC non précisé). L'inscription demande le SIREN.

Variables : **`LEGAL_MEDIATOR_NAME`**, **`LEGAL_MEDIATOR_ADDRESS`** (adresse
postale du médiateur), **`LEGAL_MEDIATOR_URL`**.

### B2. L'identité de la société

Les neuf ensemble — sans elles, ni mentions légales, ni CGV opposables, ni
factures :

| Variable | Exemple |
|---|---|
| `LEGAL_COMPANY_NAME` | `Nina & Diego` |
| `LEGAL_FORM` | `SAS` (ou `SASU`), comme sur le Kbis |
| `LEGAL_CAPITAL` | `1 000 €` |
| `LEGAL_SIRET` | les 14 chiffres ; le SIREN en est déduit |
| `LEGAL_RCS_CITY` | ville du greffe, comme sur le Kbis |
| `LEGAL_ADDRESS` | adresse du siège social |
| `LEGAL_EMAIL` | déjà posée en A2 |
| `LEGAL_PHONE` | un numéro où joindre la boutique (exigé par la loi) |
| `LEGAL_PUBLICATION_DIRECTOR` | le **président** de la SAS (son représentant légal — c'est la loi, pas un choix) |

`LEGAL_VAT_NUMBER` : seulement si la société a un numéro de TVA
intracommunautaire.

### B3. Le paiement réel

Stripe → **Verify your business** au nom de la SAS (Kbis, pièce d'identité en
couleur, IBAN de la société). Puis clés `pk_live` / `sk_live`, et une
**nouvelle** destination webhook en mode réel (le secret est différent) : les
trois variables se remplacent **ensemble**. Redéployer. Ne jamais payer avec
une vraie carte en mode test, ni une carte de test en mode réel.

### B4. Les réglages et la TVA

- `/fr/admin/reglages` : cotisations à **`0`** pour une SAS.
- À demander au comptable : la SAS sera-t-elle en **franchise en base de
  TVA** ? Le site ne sait faire que ce cas (mention « TVA non applicable,
  art. 293 B du CGI »). Si elle est assujettie, il faut d'abord ajouter le
  calcul de TVA dans le code — le dire à Claude avant la première vente.

### B5. Vercel Pro, avant d'ouvrir

L'offre gratuite (Hobby) interdit l'usage commercial ; un site qui encaisse
des paiements doit être en **Pro** (20 $ par mois). **Settings → Billing →
Upgrade**. Le dire ensuite à Claude : le balayage de la file (e-mails à
relancer, photos à télécharger) peut alors repasser toutes les 5 minutes au
lieu d'une fois par jour (`DEPLOY.md` §4 bis).

### B6. Ouvrir

Le panneau `/fr/admin` n'affiche plus rien : la boutique peut vendre.

## Décision en attente

**Les ventes du site ne remontent pas dans SuiviVinted.** L'application n'a
aucun point d'entrée pour les recevoir (vérifié dans son code). Une pièce
vendue sur le site reste donc « en vente » dans SuiviVinted et sur Vinted : elle
peut partir deux fois.

- En place aujourd'hui : l'avis « Commande à préparer » rappelle de retirer les
  pièces de Vinted et de les marquer vendues dans SuiviVinted.
- Possible : ajouter dans SuiviVinted le point d'entrée qui marque la pièce
  vendue automatiquement. C'est une modification de l'application elle-même
  (un autre dépôt, utilisé par d'autres comptes) : elle se fait sur accord
  explicite.

## Plus tard, non bloquant

- Traductions automatiques des fiches (DeepL) et sélecteur de langue dans la
  barre de navigation.
- Branchement d'un transporteur (étiquettes, suivi automatique).
- Expéditions vers le Royaume-Uni : TVA britannique à étudier avant de les
  ouvrir largement.
