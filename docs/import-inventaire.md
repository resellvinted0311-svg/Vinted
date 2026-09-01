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

## Immédiat : le déclencheur posé sur la base de l'application

Le balayage quotidien relit tout l'inventaire pour retrouver ce qui a bougé. Un
déclencheur, lui, prévient à l'instant où une ligne change — et la boutique n'a
plus qu'une pièce à traiter (`POST /api/sync/app-event`, voir
`docs/synchronisation.md` §2.8 bis).

L'entrée « Webhooks » de la console Supabase a changé de place au fil des
versions ; le SQL ci-dessous ne dépend d'aucune console. Il s'exécute UNE fois,
dans l'éditeur SQL de l'application, en remplaçant la clé.

```sql
create extension if not exists pg_net;

create or replace function public.notifier_boutique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  donnees jsonb;
begin
  if tg_op = 'DELETE' then l := old; else l := new; end if;

  -- Les seules colonnes que la boutique lit. Envoyer la ligne entière ferait
  -- circuler des champs que personne n'a examinés, pour rien.
  donnees := jsonb_build_object(
    'id', l.id,
    'workspace_id', l.workspace_id,
    'article', l.article,
    'marque', l.marque,
    'taille', l.taille,
    'etat', l.etat,
    'couleur', l.couleur,
    'description', l.description,
    'prix_achat', l.prix_achat,
    'prix_annonce', l.prix_annonce,
    'prix_vendu', l.prix_vendu,
    'en_vente', l.en_vente
  );

  -- Asynchrone : `net.http_post` met en file et rend la main. Une boutique
  -- injoignable ne doit JAMAIS retarder une saisie dans l'application.
  perform net.http_post(
    url := 'https://<boutique>/api/sync/app-event',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SYNC_API_KEY>'
    ),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', case when tg_op = 'DELETE' then null else donnees end,
      'old_record', case when tg_op = 'DELETE' then donnees else null end
    )
  );

  return null;
end;
$$;

create trigger boutique_articles
after insert or update or delete on public.articles
for each row execute function public.notifier_boutique();
```

**Pour l'enlever**, sans rien casser d'autre :

```sql
drop trigger if exists boutique_articles on public.articles;
drop function if exists public.notifier_boutique();
```

**`security definer`** parce que l'accès au schéma `net` n'est pas accordé à
tous les rôles : sans lui, le déclencheur échouerait selon le rôle qui écrit.
`set search_path` l'accompagne toujours — une fonction en `security definer`
sans chemin figé est une porte ouverte sur la résolution de noms.

**Le déclencheur ne remplace pas le balayage.** `net.http_post` ne réessaie
pas : boutique en cours de déploiement, coupure réseau, et la notification est
perdue. Le passage quotidien rattrape alors la pièce. C'est ce qui fait d'une
notification perdue un retard, et non un oubli.

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
