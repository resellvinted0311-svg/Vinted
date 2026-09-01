# Importer l'inventaire dans la boutique

Guide d'exploitation du script `scripts/importer-inventaire.ts`. Le contrat
qu'il applique est décrit dans `docs/synchronisation.md` ; ce document-ci ne dit
que comment s'en servir.

---

## À quoi il sert, et pourquoi il est provisoire

La cible reste celle du contrat : **l'application pousse** ses pièces vers
`POST /api/sync/articles`. Cela demande du code dans l'application, qui n'est
pas ce dépôt.

En attendant, ce script fait le même travail depuis un poste. Il lit
l'inventaire, traduit ses champs, et appelle **la même route publique avec la
même clé** — rien de privilégié, aucun chemin dérobé. Le jour où l'application
poussera d'elle-même, le script devient inutile et se supprime.

---

## Automatique : la tâche planifiée GitHub

`.github/workflows/synchroniser-inventaire.yml` lance ce même script **toutes
les trois heures**, et à la demande depuis l'onglet *Actions* du dépôt. Plus
rien à faire depuis un poste : une pièce mise en vente dans l'application paraît
au plus tard trois heures après, une pièce vendue disparaît dans le même délai.

Quatre secrets à poser une fois dans *Settings → Secrets and variables →
Actions* : `APP_SUPABASE_URL`, `APP_SUPABASE_SERVICE_KEY`, `APP_WORKSPACE_ID`,
`SYNC_API_KEY`. Ce sont les variables que le script attendait sur un poste,
moins une.

`BOUTIQUE_URL` n'en est pas un : l'adresse du site est imprimée sur chacune de
ses pages. En exiger un secret la faisait passer pour confidentielle et ajoutait
une manipulation pour rien. Un secret du même nom la remplace tout de même, pour
une boutique déployée ailleurs.

**La clé de l'application ne rejoint PAS l'environnement de la boutique** — voir
la section suivante, qui reste vraie. Les secrets d'Actions et les variables
d'exécution du site sont deux surfaces distinctes : la tâche planifiée occupe
exactement la place qu'occupait le poste de travail, ni plus ni moins.

### Pourquoi une cadence courte ne coûte presque rien

Depuis l'empreinte de synchronisation (`Article.syncFingerprint`), un passage
sans changement **n'écrit rien** : la boutique lit la pièce, constate que
l'application n'a rien modifié, et s'arrête là. Une douzaine d'allers-retours
par pièce deviennent un seul.

Ce n'est pas qu'une économie. `priceCents` était réécrit à chaque passage avec
le prix de l'application : **une baisse automatique décidée par la boutique
était annulée à la synchronisation suivante**, sans trace. À la main, cela
passait inaperçu ; toutes les trois heures, la baisse automatique n'aurait
jamais existé.

---

## Ce qu'il ne fait pas, délibérément

**Il ne donne pas à la boutique l'accès à l'inventaire.** La base de
l'application est multi-locataire : elle contient les stocks de dizaines
d'espaces de travail, dont la plupart appartiennent à d'autres personnes. Une
clé de service posée dans les variables d'environnement de la boutique ferait
d'une intrusion sur la boutique une fuite de tous ces stocks — et le responsable
de traitement, au sens du RGPD, c'est vous.

Ici la clé ne quitte pas le poste qui lance le script, et la lecture est bornée
à **un seul** espace de travail par `APP_WORKSPACE_ID`.

---

## Les cinq variables

| Variable | Où la trouver |
|---|---|
| `APP_SUPABASE_URL` | Supabase → Project Settings → Data API → Project URL |
| `APP_SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API Keys → `service_role` |
| `APP_WORKSPACE_ID` | voir la requête ci-dessous |
| `BOUTIQUE_URL` | l'adresse publique de la boutique, sans chemin |
| `SYNC_API_KEY` | la même valeur que dans les variables d'environnement Vercel de la boutique |

Pour l'identifiant d'espace de travail, dans l'éditeur SQL de Supabase :

```sql
select wm.workspace_id
from workspace_members wm
join auth.users u on u.id = wm.user_id
where lower(u.email) = 'votre.adresse@exemple.fr';
```

Aucune de ces valeurs ne se met dans le dépôt. Elles se passent sur la ligne de
commande, le temps d'un import.

---

## Lancer

**Toujours en simulation d'abord.** C'est le comportement par défaut : sans
`--pour-de-vrai`, la boutique est appelée en essai à blanc et répond ce qu'elle
ferait, sans rien écrire.

```sh
APP_SUPABASE_URL=... \
APP_SUPABASE_SERVICE_KEY=... \
APP_WORKSPACE_ID=... \
BOUTIQUE_URL=https://... \
SYNC_API_KEY=... \
npx tsx scripts/importer-inventaire.ts
```

Options : `--limite=50` pour n'en traiter qu'une poignée, `--pour-de-vrai` pour
écrire.

---

## Lire le rapport

Trois tableaux sortent, dans cet ordre.

**Catégories déduites — à vérifier.** C'est le tableau important. L'inventaire
n'a pas de colonne « catégorie » : elle est **déduite du libellé** de la pièce.
Un décompte aberrant — trois cents pièces en « accessoires » — signale une
déduction fausse, et il vaut mieux s'en apercevoir ici.

La catégorie ne décide pas que du rayon : elle porte aussi le **poids par
défaut**, donc le palier transporteur, donc le port réellement payé. Une écharpe
rangée en « manteaux » partirait au tarif d'un colis de 1,5 kg à chaque vente.

**Pièces écartées avant l'envoi.** Elles n'ont pas été envoyées, et le motif dit
quel champ manque :

| Motif | Ce qu'il faut corriger, dans l'application |
|---|---|
| `categorie-indeduisible` | le libellé ne dit pas quel vêtement c'est |
| `sans-etat` | l'état n'est pas renseigné |
| `sans-titre` · `sans-taille` | le champ est vide |
| `sans-prix` · `sans-cout` | prix d'annonce ou prix d'achat manquant |

**Réponse de la boutique.** `would-create` / `would-update` en simulation,
`created` / `updated` / `rejected` en écriture réelle. Les refus portent un
motif du contrat, détaillé dans `docs/synchronisation.md` §3.4.

---

## Ce que devient chaque pièce

| Dans l'inventaire | Dans la boutique |
|---|---|
| en vente, non vendue | **publiée**, visible au catalogue |
| `prix_vendu` renseigné | **retirée** de la vente (`ARCHIVED`) |
| pas marquée en vente | **retirée** de la vente (`ARCHIVED`) |

Le critère de vente est `prix_vendu`, pas `date_vente` : c'est celui de
l'application elle-même, et les deux divergent sur les lignes à demi remplies.

La boutique n'accepte jamais l'état **vendue** depuis l'extérieur. `SOLD`
s'écrit à l'encaissement : il numérote une facture et alimente le registre
comptable. Une vente conclue sur une autre place de marché n'est pas une vente
de la boutique, c'est un retrait de la vente — d'où `ARCHIVED`.

Une pièce qu'un panier tient au moment de l'import est **refusée**
(`locked-by-checkout`), avec l'échéance du verrou : on ne retire pas un article
sous quelqu'un qui est en train de le payer. Relancer l'import plus tard suffit.

---

## Ni poids ni photos

L'inventaire n'a ni l'un ni l'autre, et le script n'en invente aucun.

**Le poids** vient du poids par défaut de la catégorie. Envoyer une vraie pesée
resterait préférable — le défaut n'est qu'une moyenne de famille — mais son
absence n'empêche pas l'import.

**Les photos** sont absentes, et la fiche est publiée quand même : substitut à la
place du visuel, et **pas d'indexation** par les moteurs tant qu'aucun cliché
n'existe. Des centaines de pages sans image ni description sont exactement ce
que les moteurs comptent contre un domaine entier, y compris contre les fiches
soignées qui les entourent.

Ajouter une photo depuis le back-office (`/admin/pieces`) rend la fiche
indexable au rendu suivant, sans rien à se rappeler.

Et un import ultérieur **n'efface pas** les photos ajoutées à la main : un
tableau `images` vide dit « je n'ai rien à déclarer sur les visuels », pas
« supprime-les ». Le retrait d'une photo se fait depuis le back-office.

---

## Relancer

Le script est **idempotent** : `externalId` étant l'identifiant de la pièce dans
l'inventaire, un second passage met à jour au lieu de dupliquer. On peut donc le
relancer aussi souvent qu'on veut — c'est ainsi que les pièces vendues finissent
par sortir du catalogue.

Le débit de la route est de 30 appels par minute, soit 3 000 pièces : un
inventaire entier passe largement dans une seule exécution.
