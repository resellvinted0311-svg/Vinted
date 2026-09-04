/**
 * Vocabulaire fermé des attributs d'article.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une liste fermée, et pourquoi elle vit ici
 * ---------------------------------------------------------------------------
 * Couleur, matière et coupe ne sont pas du texte libre : chaque valeur est
 * TRADUITE en huit langues et sert de facette de filtrage. Accepter « bleu
 * pétrole » depuis l'application de gestion produirait une facette sans
 * libellé, affichée telle quelle dans les huit catalogues — et un filtre qui
 * ne ramène qu'une pièce.
 *
 * Une valeur hors liste est donc REFUSÉE, jamais ignorée en silence : ignorer
 * ferait disparaître l'information sans que personne ne l'apprenne, et la
 * pièce serait publiée avec une caractéristique en moins.
 *
 * ---------------------------------------------------------------------------
 * Le lien avec les traductions est vérifié mécaniquement
 * ---------------------------------------------------------------------------
 * `tests/i18n/messages.test.ts` exige que chaque clé listée ici possède son
 * libellé dans `catalogue.colors`, `catalogue.materials` et `catalogue.fits`
 * des huit fichiers de langue. Ajouter une valeur sans la traduire fait échouer
 * la suite, plutôt que d'apparaître un jour en production.
 *
 * Ce fichier est PUR : ni base, ni réseau, ni `server-only`. Il est lu par la
 * validation des entrées comme par les composants d'affichage.
 */

export const ARTICLE_COLORS = [
  'ecru',
  'marine',
  'kaki',
  'noir',
  'bordeaux',
  'gris',
  'camel',
] as const

export const ARTICLE_MATERIALS = [
  'coton',
  'laine',
  'lin',
  'denim',
  'cuir',
  'velours',
] as const

export const ARTICLE_FITS = ['droite', 'ajustee', 'ample', 'oversize'] as const

/**
 * L'univers d'une pièce : pour qui elle est coupée.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une valeur SUR LA PIÈCE, et non un niveau dans l'arbre
 * ---------------------------------------------------------------------------
 * L'autre forme possible était d'ajouter « Femme » et « Homme » au-dessus des
 * types de vêtements, dans l'arbre des catégories. Elle a été écartée pour
 * trois raisons vérifiées dans le dépôt.
 *
 * `Category.slug` est unique GLOBALEMENT — il n'y a pas d'unicité composite
 * sur (parent, slug). Dupliquer l'arbre imposerait donc des identifiants
 * comme « pantalons-femme » et « pantalons-homme », qui se retrouveraient
 * tels quels dans les adresses publiques.
 *
 * Ensuite, chaque fiche article résout son fil d'Ariane en remontant l'arbre
 * par une requête PAR NIVEAU. Un niveau de plus, c'est une requête de plus
 * sur les deux pages les plus servies du site.
 *
 * Enfin, une pièce mixte n'a pas de place dans un arbre : il faudrait la
 * ranger deux fois, ou inventer une troisième branche.
 *
 * ---------------------------------------------------------------------------
 * « mixte » n'est pas un troisième univers, c'est une pièce qui va aux deux
 * ---------------------------------------------------------------------------
 * La page « Femme » montre les pièces « femme » ET les pièces « mixte ». Idem
 * côté homme. Une chemise oversize ou une paire de baskets n'a pas à être
 * saisie deux fois, ni à disparaître des deux vitrines parce qu'elle
 * n'appartient franchement à aucune.
 *
 * ---------------------------------------------------------------------------
 * Une pièce SANS univers n'est pas un défaut de saisie, c'est l'état initial
 * ---------------------------------------------------------------------------
 * Le champ est facultatif. Les pièces déjà en base n'en ont pas — une
 * migration crée des tables, jamais des lignes — et l'application de gestion
 * n'envoie pas cette information. Une pièce non qualifiée reste dans le
 * catalogue et dans les recherches ; elle n'apparaît simplement dans aucun des
 * deux univers. C'est honnête, et c'est visible : l'écran d'inventaire compte
 * celles qui restent à qualifier.
 */
export const ARTICLE_AUDIENCES = ['femme', 'homme', 'mixte'] as const

/**
 * Les univers qu'une page d'univers doit interroger.
 *
 * « Femme » demande `['femme', 'mixte']`, jamais `['femme']` seul. La règle
 * est ici, en un seul endroit, parce qu'elle est appliquée à trois endroits
 * différents — la page, son plan de site, et le compte affiché sur la carte de
 * la vitrine — et que trois écritures d'une même règle finiraient par
 * diverger.
 */
export function audiencesFor(universe: 'femme' | 'homme'): string[] {
  return [universe, 'mixte']
}

/**
 * Clés de mesure, en centimètres, DANS L'ORDRE OÙ ELLES S'AFFICHENT.
 *
 * `Category.measurementKeys` dit lesquelles sont PERTINENTES pour une famille
 * — un pantalon n'a pas d'épaules. Cette liste-ci dit lesquelles EXISTENT.
 * Les deux sont utiles et ne se confondent pas : une mesure pertinente mais
 * absente est une fiche incomplète, une mesure inconnue est une erreur de
 * saisie.
 *
 * ---------------------------------------------------------------------------
 * Toutes ces mesures sont prises À PLAT. C'est une contrainte, pas un conseil
 * ---------------------------------------------------------------------------
 * « Mesures prises à plat » n'existait que dans une phrase d'aide sous le
 * tableau. Le modèle, lui, ne distinguait rien : une largeur de poitrine de
 * 52 cm et un tour de poitrine de 104 cm se rangeaient sous la même clé
 * `chest`, avec la même unité, et rien ne permettait de savoir laquelle des
 * deux on lisait.
 *
 * Deux fiches saisies selon deux conventions étaient donc indiscernables — y
 * compris pour la personne qui les a saisies, six mois plus tard. Et la
 * cliente qui compare deux pièces du même catalogue comparait parfois un
 * simple au double.
 *
 * La convention est désormais unique et elle est DITE dans les libellés :
 * « largeur de poitrine », pas « poitrine ». Un libellé qui nomme la mesure ne
 * peut pas être mal compris, là où une note en petits caractères sous un
 * tableau se lit une fois sur dix.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi seulement deux clés nouvelles
 * ---------------------------------------------------------------------------
 * La spécification en demandait cinq : `pitToPit`, `waistFlat`, `totalLength`,
 * `thigh`, `legOpening`. Sous une convention unique, les trois premières font
 * doublon avec ce qui existe — une mesure « d'aisselle à aisselle » EST la
 * largeur de poitrine, et une « longueur totale » est la longueur. Les créer
 * aurait rouvert exactement l'ambiguïté qu'on vient de fermer : deux clés pour
 * une mesure, et personne pour dire laquelle remplir.
 *
 * Restent `thigh` et `legOpening`, qui décrivent des endroits qu'aucune clé ne
 * couvrait — et que l'on demande précisément sur un jean d'occasion, parce
 * qu'une taille étiquetée ne dit rien de la coupe.
 *
 * L'ORDRE de cette liste est celui du tableau de la fiche : de haut en bas du
 * corps. Le tableau le lisait autrefois dans sa propre copie, et une clé
 * ajoutée ici sans y être répercutée se retrouvait silencieusement rangée en
 * dernier.
 */
export const MEASUREMENT_KEYS = [
  'shoulders',
  'chest',
  'waist',
  'hips',
  'length',
  'sleeve',
  'inseam',
  'thigh',
  'legOpening',
  'footLength',
] as const

/**
 * États, dans l'ordre décroissant.
 *
 * `POOR` existe parce que l'application de gestion distingue « état correct »
 * de « mauvais état ». Les confondre reviendrait à mieux annoncer une pièce
 * qu'elle n'est — ce qui finit en litige et en retour, jamais en vente.
 */
export const ARTICLE_CONDITIONS = [
  'NEW_WITH_TAGS',
  'NEW_WITHOUT_TAGS',
  'VERY_GOOD',
  'GOOD',
  'FAIR',
  'POOR',
] as const

export type ArticleCondition = (typeof ARTICLE_CONDITIONS)[number]
export type ArticleColor = (typeof ARTICLE_COLORS)[number]
export type ArticleMaterial = (typeof ARTICLE_MATERIALS)[number]
export type ArticleFit = (typeof ARTICLE_FITS)[number]
export type ArticleAudience = (typeof ARTICLE_AUDIENCES)[number]
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number]

/**
 * Bornes physiques d'une mesure, en centimètres.
 *
 * Ce ne sont pas des « coefficients métier » réglables : ce sont des garde-fous
 * contre une unité fausse. Une valeur de 380 signifie presque toujours qu'on a
 * envoyé des millimètres, et une fiche annonçant « tour de poitrine : 380 cm »
 * est plus dommageable qu'une fiche sans mesure.
 */
export const MEASUREMENT_MIN_CM = 1
export const MEASUREMENT_MAX_CM = 250
