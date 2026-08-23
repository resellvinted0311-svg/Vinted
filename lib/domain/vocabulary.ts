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
 * Clés de mesure, en centimètres.
 *
 * `Category.measurementKeys` dit lesquelles sont PERTINENTES pour une famille
 * — un pantalon n'a pas d'épaules. Cette liste-ci dit lesquelles EXISTENT.
 * Les deux sont utiles et ne se confondent pas : une mesure pertinente mais
 * absente est une fiche incomplète, une mesure inconnue est une erreur de
 * saisie.
 */
export const MEASUREMENT_KEYS = [
  'shoulders',
  'chest',
  'waist',
  'hips',
  'length',
  'sleeve',
  'inseam',
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
