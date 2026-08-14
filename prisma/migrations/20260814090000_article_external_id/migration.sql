-- Référence de la pièce dans l'application de gestion.
--
-- L'application de gestion est la source de vérité de l'inventaire : elle
-- pousse ses pièces vers la boutique. Sans identifiant externe, une seconde
-- synchronisation ne saurait pas reconnaître une pièce déjà envoyée et créerait
-- un doublon — sur un stock unitaire, deux annonces pour un seul vêtement.
--
-- Nullable : les pièces nées ici (jeu de démonstration, back-office) n'en ont
-- pas. Unique quand il est présent, ce qu'un index unique ordinaire garantit
-- déjà en PostgreSQL, où plusieurs NULL ne se gênent pas.
ALTER TABLE "Article" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Article" ADD COLUMN "externalSyncedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Article_externalId_key" ON "Article"("externalId");
