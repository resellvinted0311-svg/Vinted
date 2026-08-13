-- Un seul panier par compte.
--
-- `Cart.userId` n'a qu'un index ordinaire : rien n'empêche deux paniers de
-- porter le même compte. Le cas arrive tout seul — une personne se connecte
-- depuis deux navigateurs, chacun avec son jeton de session, et la fusion crée
-- un second panier au lieu d'alimenter le premier. Ses articles se répartissent
-- alors entre deux paniers dont un seul s'affiche.
--
-- Un index unique PARTIEL : la contrainte ne porte que sur les paniers
-- rattachés à un compte. Les paniers de visiteurs, tous à userId NULL, restent
-- libres — un index unique ordinaire les aurait limités à un seul pour toute la
-- boutique.
CREATE UNIQUE INDEX IF NOT EXISTS "Cart_userId_unique_when_set"
  ON "Cart" ("userId")
  WHERE "userId" IS NOT NULL;
