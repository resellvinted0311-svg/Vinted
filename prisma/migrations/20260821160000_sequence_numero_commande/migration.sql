-- Numérotation des commandes.
--
-- Une séquence PostgreSQL plutôt qu'un COUNT(*) + 1. Deux commandes passées à
-- la même seconde liraient le même compte et se disputeraient la contrainte
-- d'unicité : l'une des deux échouerait, au pire moment possible — juste avant
-- le paiement.
--
-- `nextval` ne revient jamais en arrière, même si la transaction qui l'a
-- appelée échoue. Des trous dans la numérotation des COMMANDES sont donc
-- possibles, et sans conséquence : ce ne sont pas des factures. La
-- numérotation des factures, elle, doit être continue et sans trou — elle aura
-- son propre mécanisme.

CREATE SEQUENCE IF NOT EXISTS "order_number_seq"
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;
