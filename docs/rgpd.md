# RGPD — ce qui est fait, ce qui reste à faire

Ce document accompagne le code. Il ne remplace ni le registre écrit de
l'article 30, ni l'avis d'un juriste : il dit exactement ce que la boutique
fait des données, pour qu'on puisse rédiger l'un et demander l'autre sur des
faits vérifiables.

Règle tenue partout : **aucune valeur n'est inventée**. Ce que le code ne sait
pas, il l'annonce comme manquant plutôt que d'afficher un texte plausible.

---

## 1. Où vit la vérité

`lib/config/privacy.ts` est la source unique. Il porte :

- le **registre des traitements** — finalité, base légale, tables concernées,
  durée de conservation, et la raison écrite de cette durée ;
- les **durées** elles-mêmes, sous forme de constantes ;
- la **liste des sous-traitants**, déduite de l'environnement réellement
  configuré.

Trois choses le lisent, et c'est ce qui empêche la déclaration de mentir :

| Qui | Ce qu'il en fait |
| --- | --- |
| `components/shop/privacy-register.tsx` | Affiche la page publique de confidentialité |
| `lib/privacy/retention.ts` | Applique les durées, toutes les cinq minutes |
| `tests/security/privacy-register.test.ts` | Vérifie la cohérence de l'ensemble |

Conséquence voulue : brancher un prestataire sans l'inscrire au registre se
remarque, et allonger une durée dans le texte sans l'allonger dans la purge est
impossible.

### La liste des sous-traitants se déduit, elle ne se déclare pas

`activeProcessors()` regarde l'environnement. Resend n'apparaît que si
`RESEND_API_KEY` est renseignée, Stripe que si `STRIPE_SECRET_KEY` l'est, et
ainsi de suite. Un service débranché disparaît de la page ; un service branché
y apparaît sans qu'on ait à y penser.

Vercel et Supabase sont inconditionnels : dès qu'il y a un site, ils traitent.

**Une réserve à connaître :** la page de confidentialité est prérendue au
build. Ajouter une clé d'API dans Vercel sans redéployer brancherait le
prestataire sans que la page le dise. Le réflexe est le même que pour n'importe
quelle variable d'environnement : une nouvelle clé, un nouveau déploiement.

### L'application de gestion n'est PAS un sous-traitant, et c'est une décision

La boutique appelle une application tierce à chaque vente, réservation ou
libération de stock (`docs/synchronisation.md`, §3). Elle ne figure pourtant
dans aucune liste de sous-traitants, et son absence n'est pas un oubli :
**le corps envoyé ne contient aucune donnée personnelle.**

Ni nom, ni adresse e-mail, ni adresse postale, ni identifiant d'acheteur, ni
même l'identifiant de la commande — qui permettrait de recouper deux ventes
faites par la même personne. Ce qui part : l'identifiant de la pièce dans
l'application, son numéro d'inventaire, l'instant du fait, et des montants.
Une application de suivi d'inventaire n'a pas besoin de savoir QUI a acheté
pour savoir qu'une pièce est partie et à quel prix.

Cette frontière est vérifiée par un test, pas seulement affirmée ici :
`tests/integration/sync-outbound.test.ts` compose une vraie commande avec un
nom, une adresse et un e-mail, puis balaye le corps réellement transmis à la
recherche de chacun. Ajouter un champ personnel à la remontée fait échouer la
suite.

Le jour où ce corps porterait la moindre donnée personnelle, l'application
deviendrait un destinataire au sens du RGPD : à inscrire au registre, à couvrir
par un contrat de sous-traitance, à faire figurer sur la page de
confidentialité, et à sécuriser au même niveau que les autres. Ce n'est pas une
formalité qu'on ajoute après coup — c'est la raison pour laquelle le corps est
construit champ par champ plutôt que par recopie d'une ligne de commande.

---

## 2. Durées de conservation

| Donnée | Durée | Pourquoi cette durée |
| --- | --- | --- |
| Compte | 3 ans sans connexion | Recommandation CNIL pour les clients inactifs |
| Commandes **payées** et factures | 10 ans | Article L123-22 du code de commerce |
| Commandes **jamais payées** | 30 jours | Aucun paiement, donc aucune pièce comptable |
| Panier d'un compte | Vie du compte | Retrouvé à chaque connexion |
| Panier et favoris d'un visiteur | 30 jours | Durée de vie du cookie qui permet de les retrouver |
| Offres d'un compte | Vie du compte | Mesure précontractuelle, effacée avec le compte |
| Offres d'un visiteur | 30 jours | Adresse e-mail et jeton : durée de vie du cookie |
| Traces d'événements de paiement et travaux différés | 30 jours | Trace technique caviardée, pour comprendre un échec |
| Sessions et jetons | Jusqu'à leur échéance | Périmés, ils n'ouvrent plus rien |
| Compteurs anti-force-brute | 1 jour | Jetons non réversibles, renouvelés chaque jour |

### La distinction qui manquait : payée ou pas

La règle « les commandes se gardent dix ans » a longtemps été appliquée à la
table `Order` **en bloc**, au motif que les factures s'y trouvent. Un tunnel de
commande abandonné — nom, rue, code postal, ville, téléphone, adresse e-mail —
n'était donc purgé par rien, indéfiniment. Or il n'est pas une pièce comptable :
aucun paiement, aucune facture, aucun exercice ne le porte. L'obligation de
l'article L123-22 ne le couvre pas, l'article 17.3.b du RGPD ne s'y applique
donc pas non plus, et il ne restait rien pour justifier de le garder
(article 5.1.e). Les abandons sont plus nombreux que les ventes.

Le prédicat de la purge porte sur `paidAt` et `invoiceNumber`, **pas sur le
statut** : `CANCELLED` recouvre deux réalités opposées — un tunnel abandonné et
une vente annulée après encaissement — et seule la date de paiement les
distingue de façon sûre.

Ces commandes sont **vidées, pas supprimées**. Un paiement a pu aboutir sans que
le webhook nous parvienne : détruire la ligne effacerait la seule trace d'un
débit à retrouver, au moment précis où elle servirait. Montants, dates et
identifiants de paiement restent ; nom, adresse, téléphone, note et jeton de
session partent.

### Ce que l'événement de paiement archivait

Le webhook Stripe écrivait l'événement **entier** en base. Un
`checkout.session.completed` transporte `customer_details` : nom, adresse
e-mail, téléphone, adresse postale complète. C'était une seconde copie des
données de la personne, hors registre, hors export et hors effacement — elle
survivait même à l'effacement du compte, juste à côté de la commande qu'on
venait de vider.

L'événement est désormais caviardé à l'écriture, par liste blanche : on énumère
les champs voulus, on n'exclut pas les champs privés. La forme des événements
appartient à Stripe, et un champ ajouté par une version future de leur interface
ne doit pas arriver dans nos journaux parce que personne n'a pensé à l'exclure.

La ligne « 30 jours » n'est pas arbitraire : les données rattachées au cookie de
session boutique ne doivent pas lui survivre. Passé ce délai, plus personne — pas
même la personne concernée — ne peut les retrouver ; les garder ne servirait
qu'à les garder. Un test vérifie que `GUEST_DATA_RETENTION_DAYS` et
`SHOP_SESSION_MAX_AGE_SECONDS` disent la même chose.

### Ce qui change de régime quand on ouvre un compte

Quatre choses appartiennent au jeton de session boutique et basculent vers le
compte à l'inscription comme à la connexion : favoris, panier, commandes payées
sans compte, offres déposées sans compte (`lib/shop/handover.ts`). Elles passent
donc de la ligne « 30 jours » à celle du compte, et c'est voulu : la personne
peut désormais les retrouver, ce qui était le seul argument justifiant la durée
courte.

Le rapprochement exige **deux** concordances, jamais une : le jeton du
navigateur **et** l'adresse e-mail. Le jeton seul ferait hériter la personne
suivante d'un poste partagé de ce que la précédente a laissé ; l'adresse seule
suffirait à s'en emparer en créant un compte au nom de quelqu'un, puisque
l'inscription par mot de passe ne vérifie pas l'adresse.

Sur les offres, les colonnes d'invité — `guestEmail`, `guestSessionToken` — sont
**effacées** au passage. Elles ne servent plus à rien : la portée passe par le
compte et la réponse part vers l'adresse du compte. Les garder laisserait une
adresse e-mail recopiée hors du compte, hors de son effacement. Les commandes
font exception sur `lockOwnerId`, qui n'est pas une donnée personnelle mais le
propriétaire d'un verrou de stock : le réécrire désynchroniserait
`Article.reservedById`.

---

## 3. Effacement : pourquoi on n'efface pas la ligne

`DELETE FROM "User"` paraît être la réponse évidente à un droit à
l'effacement. Dès qu'une commande existe, c'est l'inverse de ce qu'il faut
faire, et pour deux raisons opposées.

**Cela détruit trop.** Une facture est une pièce comptable, conservée dix ans.
L'article 17.3.b du RGPD écarte explicitement l'effacement quand une obligation
légale impose la conservation. Supprimer, c'est troquer une infraction pour une
autre.

**Cela n'efface pas assez.** La commande garde son instantané d'adresse et son
adresse e-mail. Supprimer la ligne `User` laisserait ces données en place avec
`userId` à NULL : le compte disparaît, la personne reste identifiable. Le pire
des deux mondes.

D'où `lib/privacy/anonymize.ts` :

- **sans aucune commande** → suppression réelle, avec tout ce qui en dépend ;
- **avec des commandes** → l'identité est vidée, la pièce comptable reste.

Ce qui subsiste alors est exactement ce que la loi exige : nom et adresse de
facturation (mentions obligatoires, article 242 nonies A de l'annexe II du CGI),
montants, dates. L'adresse e-mail de la commande, qui n'est pas une mention
obligatoire, est effacée ; la note du client aussi.

L'adresse de remplacement utilise le domaine `.invalid`, réservé par la
RFC 2606 : elle ne peut ni exister ni être routée.

### Un piège qui a failli passer

`UserToken` — jetons de réinitialisation de mot de passe et de vérification
d'adresse — porte une colonne `userId` **sans relation Prisma**. Aucune cascade
ne l'emporte. Un jeton survivant à l'effacement rouvrirait un compte censé ne
plus exister. Il est donc supprimé explicitement, et un test le vérifie.

---

## 4. Exercice des droits

Tout se passe dans `/compte/donnees`, sans justificatif à fournir.

| Droit | Où | Comment |
| --- | --- | --- |
| Accès et portabilité (15, 20) | `/api/compte/donnees` | Téléchargement JSON |
| Effacement (17) | `/compte/donnees` | Confirmation à recopier |
| Retrait du consentement (7.3) | `/compte/donnees` | Une case, comme à l'inscription |

**Pourquoi en ligne plutôt qu'une adresse de contact.** L'article 12.2 demande
de « faciliter » l'exercice des droits. Une boîte aux lettres le rend possible ;
l'espace personnel le facilite. La différence compte aussi en pratique : une
demande par e-mail suppose de vérifier l'identité du demandeur, ce qui conduit à
réclamer une pièce d'identité — donc à collecter **davantage** de données
personnelles pour honorer une demande de confidentialité. Une session
authentifiée règle la question sans rien collecter.

L'export ne contient ni l'empreinte du mot de passe ni les jetons de session :
ce ne sont pas des données fournies par la personne, et les remettre créerait
une cible sans rien lui apprendre. Il ne contient pas non plus les coûts
d'achat, qui sont des données de l'entreprise.

---

## 5. Information au moment de la collecte

L'article 13 porte sur le **moment** où la donnée est demandée, pas sur
l'existence d'une page quelque part. La mention figure donc sous le formulaire
d'inscription, avec le lien vers la page complète.

La page `/pages/confidentialite` n'est plus un texte d'attente : elle est
rendue depuis le registre. Les CGV et la page cookies restent en phase 7 — elles
n'ont pas d'objet tant que rien n'est vendu ni déposé.

---

## 5 bis. Ce que le second audit a trouvé

Quatre lacunes réelles, toutes corrigées, toutes couvertes par un test qui
échoue si le correctif disparaît (`tests/integration/privacy.test.ts`).

### Une adresse e-mail que rien n'effaçait

La purge des offres sans compte épargnait celles rattachées à une commande —
condition écrite « aucune ligne de commande ». Mais `OrderItem.offerId` est
écrit à la **création** de la commande, avant tout paiement. Une offre ayant
seulement servi à afficher un prix dans un tunnel abandonné sortait donc
définitivement du champ de la purge.

Le résultat était l'inverse de ce qui est annoncé : trente jours plus tard, le
tunnel abandonné était consciencieusement vidé de son e-mail et de son adresse
— et l'adresse e-mail restait, juste à côté, dans `Offer.guestEmail`, avec le
jeton du navigateur. Indéfiniment.

La bonne frontière n'est pas « une commande existe » mais « une **pièce
comptable** existe », c'est-à-dire `paidAt` — comme partout ailleurs. Et les
offres qui ont réellement servi à une vente gardent leur montant, que la
facture invoque, mais perdent l'adresse et le jeton : la commande porte déjà
l'identité de l'acheteuse, et elle, elle est anonymisée à l'échéance comptable.

### Un travail différé qui ne mourait jamais

La purge ne prenait que les travaux **terminés**, au motif qu'un travail en
échec doit rester visible « tant qu'il peut être repris ». Mais la file refuse
de reprendre au-delà de six tentatives : un travail épuisé n'est jamais repris,
n'est jamais marqué terminé, et n'était effacé par rien. Une panne du
prestataire d'e-mail au mauvais moment laissait ainsi, pour toujours, une ligne
désignant la commande d'une personne et un message d'erreur — quand le registre
et la page publique annoncent trente jours.

### Deux oublis à l'effacement du compte

`VerificationToken` s'indexe sur l'**adresse e-mail**, pas sur l'identifiant du
compte : aucune cascade ne la touche, et l'effacement l'ignorait. Deux
conséquences, dont la seconde est la pire — un lien de connexion encore dans la
boîte de la personne, cliqué après l'effacement, **recréait un compte à son
adresse**. Quelqu'un qui venait de demander la suppression de son compte s'en
retrouvait un neuf, sans avoir rien fait d'autre que cliquer sur un vieux lien.

Les **négociations** d'un compte partaient elles aussi à la dérive :
`Offer.userId` est en `SetNull`, donc une suppression dure laissait la ligne
derrière elle. Elle finissait par tomber trente jours plus tard, mais
« effacez mon compte » ne doit pas laisser de reliquat qu'un second mécanisme
rattrapera peut-être un mois après. Les avis (`Review`) étaient dans le même
cas, et pire : dans la branche « anonymisé », la ligne `User` est conservée,
donc rien ne les emportait jamais.

### Un export incomplet

`Order.servicePointId` — le point relais choisi — manquait à la copie remise.
L'omission était incohérente avec le reste : l'effacement, lui, l'**efface**,
au motif qu'il n'est pas une mention obligatoire de facture. Une donnée qu'on
juge assez personnelle pour la supprimer doit figurer dans la copie qu'on
remet ; c'est un commerce à quelques rues de chez soi, et la page annonce
« tout ce que ce site conserve à votre sujet ».

---

## 5 ter. Les journaux, qui n'étaient déclarés nulle part

Un journal de serveur est une **copie de données**, conservée ailleurs que la
base, souvent plus longtemps qu'elle, et lue par des gens qui n'ont aucune
raison d'accéder à l'identité des clientes. Le site en produisait depuis le
premier jour sans que le registre en dise un mot.

### Le défaut mesuré

Plusieurs appels journalisaient l'objet `Error` **lui-même** :

```ts
console.error('[auth] Session illisible.', error)
```

Un `Error` venu de Prisma porte, dans son `message`, l'appel qui a échoué avec
ses **arguments**. Une lecture ratée sur `prisma.user.findUnique({ where: {
email } })` inscrivait donc l'adresse e-mail en clair dans les journaux du
serveur. Personne ne l'avait voulu, et rien ne le signalait.

### Ce qui est en place

`lib/observability/` filtre à deux niveaux, et il faut les deux : par le **nom**
du champ (`email`, `phone`, `token`, `address`…) et par la **forme** de la
valeur (adresse e-mail, clé de prestataire, jeton porteur, adresse IP). Le
filtre par le nom seul est aveugle dès que la donnée voyage sous un nom
innocent — et `message` est le nom le plus innocent qui soit.

Ce qui **reste** dans les journaux, délibérément : les identifiants internes.
Sans eux, un journal ne relie plus un échec à ce qui a échoué, et un journal
inutile finit par être remplacé par un journal bavard. C'est le choix déjà
assumé par la file de travaux différés.

Un test de sécurité (`tests/security/log-redaction.test.ts`) exerce les deux
filtres, et quatre mutations vérifient qu'ils ne sont pas décoratifs.

### Sentry sans le paquet Sentry

Le paquet officiel capture tout seul l'URL de chaque requête, ses en-têtes et
parfois son corps. Sur cette boutique, **l'URL suffit à identifier quelqu'un** :
la page de retour de paiement porte l'identifiant de session Stripe.
`sendDefaultPii: false` retire l'adresse IP et les cookies, pas la chaîne de
requête.

Le transport est donc écrit à la main : rien ne part qu'on n'ait mis soi-même,
et l'enveloppe ne contient ni `user`, ni `request`, ni `contexts`, ni
`breadcrumbs` — les quatre portes par lesquelles une donnée personnelle entre
dans un outil de supervision sans que personne ne l'ait décidé. Ce qu'on y perd
est écrit dans `lib/observability/sentry.ts`.

Conséquence pour le registre : l'entrée `technical-logs` déclare enfin ce
traitement, et `activeProcessors()` — qui annonçait déjà Sentry dès que
`SENTRY_DSN` est posée — dit désormais quelque chose de vrai.

---

## 6. Colonnes déclarées, jamais alimentées

Le schéma décrit la boutique complète, phases 3 à 8 comprises. Des colonnes
existent donc en base sans qu'aucun chemin de code ne les écrive. C'est
acceptable en avance de phase — **à condition que ce soit décidé et écrit**,
parce qu'un audit du schéma les fera toutes apparaître comme « données
collectées ».

Cette section a longtemps annoncé « quatre ensembles », et le second audit a
montré que la liste en oubliait huit — dont trois zones de texte libre. Le
paragraphe qui se voulait rassurant l'était donc à tort : le tableau ci-dessous
est celui des colonnes **sur lesquelles une décision a été prise**, et la liste
qui le suit celle des modèles encore en attente. Une liste incomplète qui se
présente comme exhaustive est pire qu'une liste absente.

| Table / colonne | État | Décision |
| --- | --- | --- |
| `Account` (jetons OAuth) | Jamais écrite : le seul fournisseur est le lien magique | Les jetons y seraient stockés **en clair**. Décidé dès maintenant : ils seront chiffrés applicativement avant le premier fournisseur OAuth, pas après |
| `User.image` | Aucun chemin ne l'alimente | Conservée : `@auth/prisma-adapter` l'attend sur le modèle `User`. La retirer casserait l'adaptateur pour gagner une colonne vide |
| `UserToken` | **Branchée** depuis la réinitialisation de mot de passe | Jeton haché au repos (SHA-256), usage unique, trente minutes. La purge l'efface à échéance, l'effacement de compte la vide, et `tests/integration/password-reset.test.ts` vérifie les deux chemins |
| `NewsletterSubscriber.consentIp` | Jamais écrite | Ne stockera **jamais** une IP brute : jeton HMAC tronqué, comme les compteurs de débit |

Ces lignes n'ont pas vocation à rassurer : elles existent pour qu'on n'ait
pas à redécouvrir la question au moment de brancher chacune.

### Modèles déclarés, jamais écrits, sans décision arrêtée

Vérifié sur `lib/`, `app/` et `components/` : aucun de ces modèles n'a
d'écriture aujourd'hui.

| Modèle | Données personnelles qu'il portera | À trancher avant de le brancher |
| --- | --- | --- |
| `Conversation`, `Message` | `guestEmail`, `body` (texte libre), `attachments` | Durée de conservation d'une conversation, sort des pièces jointes, et ce qu'il advient des messages à l'effacement du compte |
| `ReturnRequest` | `comment` (texte libre) | Suit-il la durée comptable de la commande, ou une durée propre au litige ? |
| `ShipmentEvent` | `raw` (réponse brute du transporteur) | Le `raw` d'un transporteur contient nom et adresse : à caviarder à l'écriture, comme les événements de paiement. Aucun transporteur n'est branché, donc rien ne l'écrit encore |
| `Review` | `rating`, `body` (texte libre) | Un avis publié survit-il à l'effacement du compte, sous pseudonyme ? Aujourd'hui l'effacement l'emporte |
| `SizeAlert` | Critères de recherche, `maxPriceCents` | Effacée avec le compte. Reste à inscrire au registre le jour où elle notifie |
| `PushSubscription` | `endpoint` (identifiant de navigateur) | Effacée avec le compte. Le consentement aux notifications devra être horodaté |

Les trois derniers sont **déjà emportés par l'effacement du compte**. Leur
entrée au registre n'est en revanche PAS ajoutée d'avance, et c'est délibéré :
le registre est lu par la page publique de confidentialité, et y annoncer un
traitement d'avis clients alors qu'aucun avis ne peut être déposé ferait mentir
la déclaration dans l'autre sens. C'est le raisonnement déjà tenu par
`activeProcessors()`, qui déduit les sous-traitants de l'environnement plutôt
que de les énumérer.

**Ce qui a changé : la promesse ci-dessus est désormais tenue par un test.**
`tests/security/personal-data-coverage.test.ts` porte la carte des modèles
porteurs de données personnelles, et cherche dans `lib/`, `app/` et
`components/` toute ÉCRITURE vers l'un de ceux qui n'ont pas de régime arrêté.
Le jour où quelqu'un ajoute le premier `prisma.message.create()`, la suite tombe
— avec, dans le message d'échec, la question exacte à trancher et la liste des
quatre endroits à couvrir : registre, export de l'article 15, effacement,
purge.

Sans ce test, la phrase « il faudra trancher avant de brancher » n'aurait
protégé personne : on ne relit pas un document au moment d'écrire une ligne de
code. C'est ainsi que les traces de paiement et la piste d'audit avaient
échappé au registre.

### Une inexactitude trouvée par ce test : `Address`

La table figurait au registre sous « orders », était lue par l'export et
effacée avec le compte — et **écrite par rien**. Il n'existe pas de carnet
d'adresses : le tunnel de commande fige l'adresse en JSON sur la commande, et
c'est cette copie-là qui porte les données.

Le registre annonçait donc un traitement qui n'a pas lieu. Ce n'est pas une
faille, c'est une déclaration inexacte — exactement dans le sens que ce document
reproche aux politiques rédigées à la main. `Address` a été retirée de l'entrée
« orders » ; elle y reviendra le jour où le carnet existera, et le test tombera
pour l'exiger.

`Shipment` a quitté ce tableau : elle est écrite depuis que l'expédition
existe. Son volet est complet — entrée `shipments` au registre, numéro de suivi
dans l'export de l'article 15, effacement à la demande et à l'échéance
comptable (`stripShipmentTracking`). Une seule question reste ouverte, et elle
est inscrite comme telle dans `DEPLOY.md` : le suivi n'est **pas** une pièce
comptable, il suit pourtant aujourd'hui la durée de la commande. Lui donner une
durée propre, plus courte, serait plus juste au regard de l'article 5.1.e —
mais aucune des durées que le code connaît ne la fonde, et en inventer une
pour avoir l'air rigoureux ferait exactement ce que ce document reproche aux
politiques rédigées à la main.

`AuditLog` a quitté cette liste de surveillance, et pas seulement parce qu'elle
est maintenant purgée.

La note de vigilance disait : « le jour où elle enregistrera l'avant/après d'une
ligne `User` ou `Order`, elle deviendra une copie de données personnelles à
conservation illimitée ». C'était exact, et c'était insuffisant : personne ne
relit une note de vigilance au moment d'ajouter une ligne de code, et
`before`/`after` sont des colonnes `Json` libres — y déverser une ligne entière
est le geste le plus naturel du monde.

Trois choses ont changé :

- **le contenu est borné par construction.** `lib/audit/trail.ts` est le seul
  chemin autorisé vers cette table. Son type n'accepte que des scalaires et des
  tableaux de scalaires — un objet imbriqué ne compile pas — et ce qui passe
  subit le même filtre de forme que le journal ;
- **le contournement est détecté.** `tests/security/audit-trail.test.ts`
  parcourt `lib/`, `app/` et `components/` et refuse tout appel direct à
  `auditLog.create` ailleurs que dans ce module. Il vérifie aussi l'inverse —
  qu'un appelant existe — pour qu'une piste d'audit vide ne passe pas pour une
  conformité ;
- **la table est purgée**, et déclarée au registre sous `audit-trail`.

La durée retenue est celle de la commande décrite : un événement d'audit qui dit
« un remboursement est dû sur cette vente » n'a pas à survivre à la vente, ni à
mourir avant elle. C'est une durée **dérivée**, pas inventée. Une durée propre,
plus courte, se défendrait — elle est inscrite comme décision ouverte dans
`DEPLOY.md`.

---

## 7. Ce qui reste à faire

Ces points ne se règlent pas dans le code.

0. **Deux durées à trancher, quand la boutique tournera.**

   - *La note libre laissée à la commande.* Sur une commande livrée, elle ne
     sert plus rien passé le délai de rétractation et celui d'un litige. Elle
     est aujourd'hui conservée dix ans avec la pièce comptable, ce qui est
     défendable mais généreux. Fixer une durée demande de connaître la réalité
     des retours — c'est une décision, pas un calcul.

   - *Les commandes payées sans compte.* Elles relèvent bien des dix ans, mais
     leur titulaire ne peut pas s'authentifier pour demander la minimisation de
     ce qui n'est pas obligatoire (note, téléphone). La page de confidentialité
     indique désormais la voie — nous écrire, identité vérifiée avant réponse —
     et le traitement est manuel tant qu'il n'y a pas de back-office.

   - *Les transporteurs.* Aucun n'est branché aujourd'hui, donc aucun ne figure
     dans la liste des sous-traitants — qui se déduit de l'environnement réel.
     Le jour où un transporteur recevra nom, adresse et téléphone, il devra y
     entrer, et son contrat de sous-traitance avec.

1. **Identité du responsable de traitement.** Tant que `LEGAL_COMPANY_NAME`,
   `LEGAL_SIRET`, `LEGAL_ADDRESS` et `LEGAL_EMAIL` ne sont pas renseignées, la
   page de confidentialité et les mentions légales l'annoncent au lieu
   d'inventer. À renseigner en variables d'environnement Vercel.

2. **Médiateur de la consommation.** Adhésion **obligatoire** pour tout
   commerce en ligne B2C français (article L612-1 du code de la consommation),
   et la démarche est externe, payante et longue : à engager maintenant. Tant
   qu'elle n'aboutit pas, les mentions légales affichent l'absence au lieu de
   l'omettre en silence, et le formulaire type de rétractation attend l'identité
   de l'entreprise pour être publié.

3. **Contrats de sous-traitance (article 28).** Chaque prestataire de la liste
   doit être couvert par un accord de traitement des données. Vercel, Supabase,
   Resend, Stripe, Upstash et Cloudinary en publient un, à accepter depuis leur
   console. Rien dans le code ne peut le faire à votre place.

4. **Registre écrit de l'article 30.** Obligatoire même pour une petite
   structure dès lors que le traitement n'est pas occasionnel — ce qui est le
   cas d'une boutique. Le tableau de la section 2, plus la liste des
   sous-traitants, en constituent la matière.

5. **Bandeau cookies.** Aucun n'est nécessaire, et c'est un vrai avantage :
   ni écran d'accueil à cliquer, ni dégradation des Core Web Vitals, ni
   registre de consentements à tenir. Il ne reste que deux cookies, tous deux
   strictement nécessaires : la session d'authentification et la session
   boutique.

   Le cookie de langue a été **retiré** pour préserver cette propriété : posé
   sur simple lecture de l'en-tête du navigateur, il déposait un identifiant de
   douze mois sans qu'aucun choix n'ait été fait — or un cookie de préférence
   n'échappe au consentement que s'il résulte d'un choix explicite. La langue
   est désormais déduite de l'en-tête à chaque requête, ce qui ne stocke rien,
   et portée par le préfixe d'URL.

   **Le jour où une mesure d'audience ou un pixel publicitaire est ajouté, un
   bandeau devient obligatoire** — et le script ne doit pas être chargé avant le
   consentement.

6. **Newsletter : double opt-in, à trancher.** Le schéma prévoit déjà un
   dispositif complet et jamais alimenté (`NewsletterSubscriber` : source du
   consentement, preuve, jeton de désinscription, `confirmedAt` avec la règle
   « tant qu'il est nul, aucun envoi »). Le code, lui, écrit un simple booléen.
   Trois conséquences : pas de double confirmation, que la CNIL considère comme
   la seule preuve solide en B2C ; aucun jeton pour le lien de désabonnement
   obligatoire de chaque e-mail (article L34-5 du CPCE) ; et le texte réellement
   consenti vit dans les fichiers de traduction, donc modifiable par un commit
   sans laisser de trace.

   Le branchement attend **une décision commerciale** : le double opt-in réduit
   mécaniquement le taux d'inscription. Il faut aussi le texte définitif de la
   case à cocher, qui sera alors versionné et horodaté comme `cgvVersion`.

7. **Analyse d'impact (AIPD).** Non requise ici : pas de profilage à grande
   échelle, pas de données sensibles, pas de surveillance systématique. À
   réexaminer si une recommandation personnalisée ou un ciblage publicitaire
   apparaît.
