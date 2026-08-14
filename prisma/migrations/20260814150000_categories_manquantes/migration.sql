-- Cinq familles de vêtements qui n'avaient aucune catégorie.
--
-- Jupes, shorts et bermudas, maillots de bain, lingerie et nuit, combinaisons.
-- L'application de gestion en a plusieurs centaines en stock et a refusé — à
-- raison — de les ranger de force ailleurs : une jupe classée dans « robes »
-- fausse le filtrage et trompe la cliente.
--
-- Insérées ici et pas seulement dans le seed : celui-ci ne s'exécute plus que
-- sur demande explicite, et une base déjà peuplée ne le verrait jamais passer.
--
-- Identifiants fixes et lisibles plutôt qu'aléatoires : la migration reste
-- rejouable, et ces lignes se reconnaissent d'un coup d'œil en base.


INSERT INTO "Category" ("id", "slug", "parentId", "position", "defaultWeightGrams", "measurementKeys", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'jupes', (SELECT "id" FROM "Category" WHERE "slug" = 'bas'), 2, 300, ARRAY['waist','hips','length'], now(), now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'fr', 'Jupes', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'en', 'Skirts', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'es', 'Faldas', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'it', 'Gonne', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'nl', 'Rokken', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'de', 'Röcke', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'pt', 'Saias', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_jupes', 'pl', 'Spódnice', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;


INSERT INTO "Category" ("id", "slug", "parentId", "position", "defaultWeightGrams", "measurementKeys", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'shorts', (SELECT "id" FROM "Category" WHERE "slug" = 'bas'), 3, 250, ARRAY['waist','hips','inseam','length'], now(), now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'fr', 'Shorts et bermudas', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'en', 'Shorts', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'es', 'Pantalones cortos', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'it', 'Shorts e bermuda', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'nl', 'Shorts en bermuda''s', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'de', 'Shorts und Bermudas', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'pt', 'Calções', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_shorts', 'pl', 'Szorty i bermudy', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;


INSERT INTO "Category" ("id", "slug", "parentId", "position", "defaultWeightGrams", "measurementKeys", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'maillots-de-bain', NULL, 9, 150, ARRAY['chest','waist'], now(), now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'fr', 'Maillots de bain', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'en', 'Swimwear', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'es', 'Bañadores', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'it', 'Costumi da bagno', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'nl', 'Badkleding', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'de', 'Bademode', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'pt', 'Fatos de banho', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_maillots_de_bain', 'pl', 'Stroje kąpielowe', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;


INSERT INTO "Category" ("id", "slug", "parentId", "position", "defaultWeightGrams", "measurementKeys", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'lingerie-nuit', NULL, 10, 120, ARRAY['chest','waist'], now(), now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'fr', 'Lingerie et nuit', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'en', 'Lingerie and nightwear', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'es', 'Lencería y pijamas', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'it', 'Intimo e pigiami', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'nl', 'Lingerie en nachtkleding', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'de', 'Wäsche und Nachtwäsche', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'pt', 'Lingerie e pijamas', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_lingerie_nuit', 'pl', 'Bielizna i piżamy', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;


INSERT INTO "Category" ("id", "slug", "parentId", "position", "defaultWeightGrams", "measurementKeys", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'combinaisons', NULL, 11, 500, ARRAY['shoulders','chest','waist','hips','length'], now(), now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'fr', 'Combinaisons', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'en', 'Jumpsuits', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'es', 'Monos', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'it', 'Tute', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'nl', 'Jumpsuits', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'de', 'Overalls', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'pt', 'Macacões', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;
INSERT INTO "CategoryTranslation" ("categoryId", "locale", "name", "createdAt", "updatedAt")
VALUES ('cat_combinaisons', 'pl', 'Kombinezony', now(), now())
ON CONFLICT ("categoryId", "locale") DO NOTHING;

