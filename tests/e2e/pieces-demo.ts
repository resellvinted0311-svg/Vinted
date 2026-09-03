/**
 * Les pièces du jeu de démonstration que les tests de navigateur désignent
 * par leur adresse.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elles vivent ici, et plus dans chaque fichier de test
 * ---------------------------------------------------------------------------
 * Le semis tire toutes ses valeurs d'un générateur pseudo-aléatoire unique,
 * semé une fois. C'est ce qui le rend reproductible — et ce qui le rend
 * fragile : chaque tirage avance le flux, donc ajouter un tirage quelque part
 * décale tout ce qui vient après.
 *
 * Ajouter deux clés de mesure aux pantalons a suffi. La marque, la taille et
 * le prix de tous les articles suivants ont changé, trois adresses écrites en
 * dur dans les tests ont cessé d'exister, et seize tests sont tombés — en huit
 * minutes de délais d'attente, sans qu'aucun ne parle de mesures.
 *
 * Deux mesures ont été prises. Les valeurs de mesure sont désormais tirées
 * d'un flux propre à chaque article (`randIntStable` dans `prisma/seed.ts`),
 * donc le vocabulaire de mensurations peut grandir sans rien déplacer. Et les
 * adresses dont dépendent les tests sont réunies ici, où un semis qui bouge
 * ne demande de corriger qu'un seul endroit.
 *
 * ---------------------------------------------------------------------------
 * Ce qui les vérifie
 * ---------------------------------------------------------------------------
 * `tests/integration/pieces-demo.test.ts` confronte ces trois adresses à la
 * base, et vérifie les propriétés dont chaque test dépend — disponible,
 * négociable, fenêtre d'offres ouverte, vendue. Il échoue en une seconde et
 * dit lequel manque, là où les tests de navigateur mettent huit minutes à
 * conclure « clic impossible ».
 */

/** Disponible, légère, ajoutable au panier. Sert au parcours d'achat. */
export const PIECE_ACHETABLE = 'accessoires-burberry-l-8'

/**
 * Disponible, négociable, et sa fenêtre d'offres est OUVERTE.
 *
 * Affichée 39,21 €, plancher à 24,40 € : une proposition à 30,00 € est donc
 * sous le prix demandé et au-dessus du refus automatique. C'est exactement ce
 * qu'exerce le test « enregistre une proposition » — l'offre doit attendre une
 * réponse, ni être acceptée, ni être refusée sur-le-champ.
 */
export const PIECE_NEGOCIABLE = 'sacs-levis-tu-12'

/** Déjà partie : sa page reste consultable, elle ne se négocie plus. */
export const PIECE_VENDUE = 't-shirts-adidas-m-44'
