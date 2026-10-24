-- Rétractation en ligne : l'adresse saisie par la personne. Une déclaration
-- dont l'adresse diffère de celle de la commande n'est plus jetée — elle est
-- gardée, avec cette adresse, pour que la boutique fasse confirmer.
ALTER TABLE "ReturnRequest" ADD COLUMN "declaredEmail" TEXT;
