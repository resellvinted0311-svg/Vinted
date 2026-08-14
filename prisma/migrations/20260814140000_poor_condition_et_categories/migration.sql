-- Deux ajouts demandés par l'application de gestion, tous deux justifiés.
--
-- 1. L'état POOR — « mauvais état ».
--
-- L'application distingue « état correct » de « mauvais état ». Le second
-- n'avait aucun équivalent, et l'envoyer en FAIR aurait été mentir sur l'état
-- d'une pièce : ce genre de raccourci finit en litige et en retour, pas en
-- vente. On ajoute donc la valeur plutôt que d'écraser la nuance.
ALTER TYPE "ArticleCondition" ADD VALUE IF NOT EXISTS 'POOR';
