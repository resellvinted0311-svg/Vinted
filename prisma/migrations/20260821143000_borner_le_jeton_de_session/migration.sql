-- Borne la longueur du jeton de session boutique.
--
-- Cette colonne est une clé indexée, et elle acceptait n'importe quelle
-- longueur. Un index PostgreSQL refuse toute entrée dépassant ~2704 octets :
-- au-delà, chaque mise en favori serait devenue une erreur 500 non rattrapée.
--
-- Le jeton signé fait 55 caractères. 64 laisse la marge nécessaire sans
-- rouvrir le trou.
--
-- Les jetons émis avant la signature ne portent pas de signature : ils ne
-- passent plus la validation, donc plus aucun navigateur ne peut désigner les
-- lignes qui s'y rattachent. Le traitement diffère selon ce qu'on perdrait.

-- Favoris de visiteurs : rattachés au seul cookie. Sans jeton valide, plus
-- personne ne peut les retrouver — pas même la personne concernée. Ils sont
-- déjà orphelins ; on les efface.
DELETE FROM "GuestFavorite"
WHERE "sessionToken" !~ '^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$';

-- Paniers SANS compte : même raisonnement, mêmes conséquences.
-- Les lignes de panier suivent par cascade.
DELETE FROM "Cart"
WHERE "userId" IS NULL
  AND "sessionToken" !~ '^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$';

-- Paniers AVEC compte : surtout pas de suppression. La personne les retrouve
-- par son identifiant de compte, que la lecture du panier consulte en premier.
-- On neutralise seulement le jeton, en lui donnant une forme qui ne peut
-- correspondre à aucun cookie (elle ne passe pas la validation), tout en
-- restant unique et courte.
UPDATE "Cart"
SET "sessionToken" = 'herite-' || "id"
WHERE "userId" IS NOT NULL
  AND "sessionToken" !~ '^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$';

ALTER TABLE "GuestFavorite"
  ALTER COLUMN "sessionToken" TYPE VARCHAR(64);

ALTER TABLE "Cart"
  ALTER COLUMN "sessionToken" TYPE VARCHAR(64);
