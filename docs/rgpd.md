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

---

## 2. Durées de conservation

| Donnée | Durée | Pourquoi cette durée |
| --- | --- | --- |
| Compte | 3 ans sans connexion | Recommandation CNIL pour les clients inactifs |
| Commandes **payées** et factures | 10 ans | Article L123-22 du code de commerce |
| Commandes **jamais payées** | 30 jours | Aucun paiement, donc aucune pièce comptable |
| Panier d'un compte | Vie du compte | Retrouvé à chaque connexion |
| Panier et favoris d'un visiteur | 30 jours | Durée de vie du cookie qui permet de les retrouver |
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

## 6. Colonnes déclarées, jamais alimentées

Le schéma décrit la boutique complète, phases 3 à 8 comprises. Quatre
ensembles de colonnes existent donc en base sans qu'aucun chemin de code ne
les écrive. C'est acceptable en avance de phase — **à condition que ce soit
décidé et écrit**, parce qu'un audit du schéma les fera toutes apparaître
comme « données collectées ».

| Table / colonne | État | Décision |
| --- | --- | --- |
| `Account` (jetons OAuth) | Jamais écrite : le seul fournisseur est le lien magique | Les jetons y seraient stockés **en clair**. Décidé dès maintenant : ils seront chiffrés applicativement avant le premier fournisseur OAuth, pas après |
| `User.image` | Aucun chemin ne l'alimente | Conservée : `@auth/prisma-adapter` l'attend sur le modèle `User`. La retirer casserait l'adaptateur pour gagner une colonne vide |
| `UserToken` | Déclarée, non branchée | Sera utilisée par la réinitialisation de mot de passe. La purge l'efface déjà à échéance, et l'effacement de compte la vide explicitement |
| `NewsletterSubscriber.consentIp` | Jamais écrite | Ne stockera **jamais** une IP brute : jeton HMAC tronqué, comme les compteurs de débit |

Ces lignes n'ont pas vocation à rassurer : elles existent pour qu'on n'ait
pas à redécouvrir la question au moment de brancher chacune.

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
