-- Mémorise le propriétaire du verrou de stock sur la commande.
--
-- Sans cette colonne, la libération du stock d'une commande abandonnée
-- s'écrivait « toute pièce de cette commande qui est RÉSERVÉE redevient
-- disponible » — sans regarder à QUI appartenait la réservation.
--
-- Conséquence, vérifiée : une commande O1 abandonnée voit son verrou expirer,
-- une autre personne achète la pièce (commande O2, verrou à son nom), puis le
-- balayage annule O1 et libère la pièce que O2 était en train de payer. La
-- pièce repart à la vente pendant que quelqu'un la paie.
--
-- Nullable : les commandes antérieures n'ont pas cette information. Le code
-- refuse alors de libérer quoi que ce soit plutôt que de libérer à l'aveugle —
-- le balayage des verrous expirés s'en chargera de toute façon.

ALTER TABLE "Order" ADD COLUMN "lockOwnerId" TEXT;

CREATE INDEX "Order_lockOwnerId_status_idx"
  ON "Order" ("lockOwnerId", "status");
