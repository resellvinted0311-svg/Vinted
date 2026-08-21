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

---

## 2. Durées de conservation

| Donnée | Durée | Pourquoi cette durée |
| --- | --- | --- |
| Compte | 3 ans sans connexion | Recommandation CNIL pour les clients inactifs |
| Commandes et factures | 10 ans | Article L123-22 du code de commerce |
| Panier et favoris d'un visiteur | 30 jours | Durée de vie du cookie qui permet de les retrouver |
| Sessions et jetons | Jusqu'à leur échéance | Périmés, ils n'ouvrent plus rien |
| Compteurs anti-force-brute | 1 jour | Jetons non réversibles, renouvelés chaque jour |

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

## 6. Ce qui reste à faire

Ces points ne se règlent pas dans le code.

1. **Identité du responsable de traitement.** Tant que `LEGAL_COMPANY_NAME`,
   `LEGAL_SIRET`, `LEGAL_ADDRESS` et `LEGAL_EMAIL` ne sont pas renseignées, la
   page de confidentialité et les mentions légales l'annoncent au lieu
   d'inventer. À renseigner en variables d'environnement Vercel.

2. **Contrats de sous-traitance (article 28).** Chaque prestataire de la liste
   doit être couvert par un accord de traitement des données. Vercel, Supabase,
   Resend, Stripe, Upstash et Cloudinary en publient un, à accepter depuis leur
   console. Rien dans le code ne peut le faire à votre place.

3. **Registre écrit de l'article 30.** Obligatoire même pour une petite
   structure dès lors que le traitement n'est pas occasionnel — ce qui est le
   cas d'une boutique. Le tableau de la section 2, plus la liste des
   sous-traitants, en constituent la matière.

4. **Bandeau cookies.** Aucun cookie de mesure d'audience ni de publicité n'est
   posé aujourd'hui : les seuls cookies sont la session d'authentification et la
   session boutique, tous deux strictement nécessaires, donc exemptés de
   consentement. **Le jour où une mesure d'audience ou un pixel publicitaire est
   ajouté, un bandeau devient obligatoire** — et le script ne doit pas être
   chargé avant le consentement.

5. **Analyse d'impact (AIPD).** Non requise ici : pas de profilage à grande
   échelle, pas de données sensibles, pas de surveillance systématique. À
   réexaminer si une recommandation personnalisée ou un ciblage publicitaire
   apparaît.
