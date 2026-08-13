-- Rattacher les collectivités du Pacifique à la zone outre-mer.
--
-- La Nouvelle-Calédonie (988), la Polynésie française (987), Wallis-et-Futuna
-- (986) et les Terres australes (984) portent le code pays FR mais des codes
-- postaux absents de la grille. Elles retombaient donc sur la zone générique
-- « France métropolitaine » : Nouméa était facturée au tarif de Paris, à un
-- tiers du coût réel, sans qu'aucune erreur ne le signale.
--
-- Corrigé dans prisma/seed-data/shipping.ts, mais le seed ne s'exécute que sur
-- un catalogue vide : sans cette migration, une base déjà peuplée garderait la
-- grille fausse indéfiniment.
--
-- Idempotent : on n'ajoute que les préfixes absents, et le libellé n'est
-- réécrit que s'il porte encore l'ancienne valeur.

UPDATE "ShippingZone"
SET "postalPrefixes" = ARRAY(
      SELECT DISTINCT unnest("postalPrefixes" || ARRAY['984', '986', '987', '988'])
      ORDER BY 1
    ),
    "updatedAt" = now()
WHERE "code" = 'FR_DOM';

UPDATE "ShippingZone"
SET "name" = 'Outre-mer',
    "updatedAt" = now()
WHERE "code" = 'FR_DOM' AND "name" = 'DOM-TOM';
