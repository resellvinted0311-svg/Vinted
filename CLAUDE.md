# Nina & Diego — consignes de travail

Boutique en ligne de vêtements de seconde main, un seul vendeur. Next.js 15
(App Router), Prisma 6, PostgreSQL, Tailwind v4, next-intl (8 langues),
hébergée chez Vercel. Le catalogue est alimenté par l'application de gestion
SuiviVinted (voir « Synchronisation » plus bas).

**Ce qui reste à faire avant de vendre, et dans quel ordre :
[`docs/mise-en-service.md`](docs/mise-en-service.md).** À relire en début de
session et à tenir à jour dès qu'un point avance.

## Écriture

- Commentaires, messages de commit et textes de l'interface **en français**.
- Les commentaires disent POURQUOI, et nomment le défaut concret qu'ils
  évitent. Ils ne paraphrasent pas le code.
- Formatage : `npx prettier --single-quote --no-semi --write <fichiers>`.
- Tout texte affiché passe par `messages/*.json`, dans les huit langues.
  `tests/domain/messages.test.ts` vérifie que les clés concordent.

## Règles qui ne se discutent pas

- Validation Zod sur **toute** entrée, y compris les Server Actions.
- Prix, remises, port : recalculés serveur, jamais lus depuis le client.
- Signature vérifiée sur tous les webhooks, sur le body brut.
- Mots de passe : argon2id. Sessions httpOnly, secure, sameSite=lax.
- Routes admin protégées par le middleware **et** par une vérification du
  rôle dans chaque action serveur (jamais uniquement dans le middleware).
- `costCents`, `floorPriceCents`, `internalNotes` ne sortent **jamais** dans
  une réponse publique : sélecteurs Prisma explicites, jamais de `SELECT *`
  renvoyé tel quel.
- Upload : type MIME réel (octets d'en-tête), taille max, dimensions max,
  suppression des métadonnées EXIF.
- Logs structurés + Sentry, sans données personnelles.
- Aucun coefficient en dur, aucun chiffre inventé. Un tarif, un taux ou une
  obligation légale vient d'une source vérifiée, citée en commentaire.
- Interdits par le cahier des charges : messages d'activité fabriqués,
  comptes à rebours, prix barrés, affirmations invérifiables, création de
  compte obligatoire, défilement infini, fenêtres de sortie, filtres sur des
  données qui n'existent pas.

## Secrets

Jamais dans le dépôt (il est **public**), jamais dans la conversation. Le
projet a déjà connu un mot de passe publié avec son code. Les secrets se
génèrent avec `openssl rand -base64 32` et se posent à la main, par les
propriétaires du compte, dans les variables d'environnement Vercel. Ne jamais
demander de coller une clé dans la conversation, ni en poser par un connecteur.

Ce fichier étant public, il ne contient rien de personnel : ni adresse, ni
chiffre d'affaires, ni situation fiscale.

## Git et déploiement

- Branche de travail : `claude/secondhand-clothing-shop-kefiil`. Pousser après
  chaque commit : un conteneur recyclé a déjà fait perdre cinq commits.
- **`main` = production.** Un push sur `main` déploie le site public. Il faut
  un accord explicite, donné à chaque fois.
- Pas de pull request sans demande.
- Adresse publique actuelle : https://vinted-iota.vercel.app. Les adresses par
  déploiement (`vinted-*-vinted8.vercel.app`) sont protégées par Vercel.
- État d'un déploiement : l'API GitHub (`repos/…/deployments`). Les
  connecteurs Vercel et Supabase disponibles dans les sessions pointent vers
  **d'autres projets** que la boutique : n'y rien lire ni modifier pour elle.

## Synchronisation avec SuiviVinted

- Contrat : `docs/synchronisation.md`. L'application est la source de vérité
  de l'inventaire.
- Webhook de base de données sur la table `articles` →
  `POST /api/sync/app-event` (création, modification, suppression = archivage),
  et rattrapage quotidien à 3 h (`vercel.json`).
- Le code de SuiviVinted est dans le dépôt privé `resell` (lecture seule
  depuis ces sessions). Sa table `articles` n'a **aucune colonne photo** : les
  photos s'ajoutent depuis la régie de la boutique (Pièces → une pièce →
  Photos). Une synchronisation n'efface jamais une photo ajoutée ainsi.
- SuiviVinted **ne reçoit pas** les ventes faites sur la boutique (pas de
  point d'entrée de son côté). Voir le point correspondant dans
  `docs/mise-en-service.md`.

## Environnement local

- PostgreSQL s'arrête parfois : `service postgresql start`. Base :
  `postgresql://vinted:vinted@localhost:5432/vinted`.
- `.env` est ignoré par git ; s'il manque, le recréer depuis `.env.example`
  avec des secrets tirés par `openssl rand -base64 32`.
- Seed et scripts : `set -a && . ./.env && set +a` d'abord.
- Tests : `pnpm test` (unitaires + intégration), `pnpm test:e2e`
  (Playwright, contre `next start`). Le limiteur de débit est en mémoire :
  redémarrer `next start` entre deux passes e2e (10 connexions admin par
  15 min).
- `tests/setup-env.ts` allume la négociation (`OFFERS_ENABLED=1`) pour la
  suite ; en production elle est éteinte.

## Façon de travailler

- Explications simples, étapes exactes, dans l'ordre.
- Vérifier plutôt que supposer, et dire ce qui n'a pas pu être vérifié.
- Travail proportionné : pas d'audit lourd quand on demande un point d'étape.
