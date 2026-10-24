-- Rétractation en ligne : le nom déclaré dans la fonction « Renoncer au
-- contrat ici ». Colonne facultative : les demandes de retour à venir n'en
-- auront pas, et aucune ligne existante n'est touchée.
ALTER TABLE "ReturnRequest" ADD COLUMN "declaredName" TEXT;
