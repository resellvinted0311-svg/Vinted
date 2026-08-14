-- Supprimer les comptes de démonstration insérés en production.
--
-- Le script de build lançait le seed dès qu'il trouvait un catalogue vide —
-- l'état d'une base neuve. Le jeu de démonstration a donc été inséré dans la
-- base de production au premier déploiement, comptes compris : un compte de
-- rôle ADMIN dont le mot de passe figurait en clair dans un dépôt public.
--
-- Le code est corrigé (garde d'environnement dans le seed, seed devenu
-- explicite dans le build), mais corriger le code ne supprime pas la ligne
-- déjà écrite. C'est le rôle de cette migration.
--
-- Portée volontairement étroite : le domaine .test est réservé par la RFC 2606
-- et ne peut appartenir à aucune vraie cliente. Aucun compte réel ne peut donc
-- être touché.
--
-- Les sessions partent d'abord : supprimer l'utilisateur sans elles laisserait
-- une session ouverte utilisable jusqu'à son échéance.
DELETE FROM "Session"
WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@nina-diego.test');

DELETE FROM "Account"
WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@nina-diego.test');

DELETE FROM "User" WHERE "email" LIKE '%@nina-diego.test';
