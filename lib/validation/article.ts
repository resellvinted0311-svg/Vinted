import { z } from 'zod'

import {
  ARTICLE_COLORS,
  ARTICLE_MATERIALS,
  ARTICLE_AUDIENCES,
  ARTICLE_FITS,
  ARTICLE_CONDITIONS,
  MEASUREMENT_KEYS,
  MEASUREMENT_MIN_CM,
  MEASUREMENT_MAX_CM,
} from '@/lib/domain/vocabulary'

/**
 * Ce qu'un formulaire d'administration a le droit d'écrire sur une pièce.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce schéma n'est pas `syncArticleSchema`
 * ---------------------------------------------------------------------------
 * Les deux décrivent la même pièce, mais pas les mêmes obligations. La
 * synchronisation exige un `externalId` — c'est son pivot, celui qui lui permet
 * de retrouver la fiche au prochain envoi — et des URL d'images publiques. Une
 * pièce née ici n'a ni l'un ni l'autre : elle n'appartient à aucun système
 * externe, et ses photos arrivent en octets depuis un navigateur.
 *
 * Surtout, `externalId` n'est pas décoratif. Les pièces qui en portent un
 * entrent dans le flux du partenaire : un import ultérieur portant le même
 * identifiant écraserait sans bruit une fiche saisie à la main. Une pièce
 * créée ici garde donc `externalId` nul, et c'est cette colonne qui distingue
 * les deux mondes.
 *
 * ---------------------------------------------------------------------------
 * Les montants arrivent en EUROS, sous forme de texte
 * ---------------------------------------------------------------------------
 * Le cahier des charges est catégorique : « prix, remises, port : recalculés
 * serveur, jamais lus depuis le client ». Ce qui traverse le réseau est donc la
 * chaîne que la boutiquière a tapée — « 24,50 » — et `parseAmountToCents` en
 * fait des centimes côté serveur.
 *
 * Accepter directement un nombre de centimes rendrait la fraude triviale, mais
 * ce n'est pas le seul motif : une chaîne saisie porte les deux séparateurs
 * décimaux, les espaces, et le symbole. Convertir dans le navigateur puis faire
 * confiance au résultat, c'est faire confiance à la locale du navigateur pour
 * décider si « 1.500 » vaut un euro cinquante ou mille cinq cents euros.
 *
 * Le PRIX PLANCHER, lui, n'est jamais reçu du tout : il est recalculé à chaque
 * écriture depuis le coût d'achat et le poids.
 */

/** Le texte d'un montant, tel qu'il se tape. Converti serveur. */
const euroText = z
  .string()
  .trim()
  .min(1)
  .max(16)

/**
 * Borne de sécurité sur le poids — PAS le palier transporteur.
 *
 * Le vrai refus se décide contre la grille de port réellement tarifée,
 * emballage compris. Ici on écarte l'absurde, pour ne pas faire d'aller-retour
 * en base sur une valeur qui n'a aucune chance.
 */
const MAX_WEIGHT_GRAMS = 50_000

/**
 * Les mesures, en centimètres.
 *
 * Saisies en texte pour la même raison que les montants : « 52,5 » et « 52.5 »
 * sont la même mesure, et c'est au serveur d'en décider.
 */
const measurementText = z.string().trim().max(10)

export const MEASUREMENT_LIMITS = {
  min: MEASUREMENT_MIN_CM,
  max: MEASUREMENT_MAX_CM,
} as const

/**
 * Les champs communs à la création et à la modification.
 *
 * Un objet de champs plutôt qu'un schéma qu'on étendrait : création et
 * modification n'ont pas les mêmes clés obligatoires — l'une n'a pas encore
 * d'`updatedAt` à comparer, l'autre en a besoin — et chacune applique son
 * propre `.strict()`. Un `.strict()` hérité qu'on relâche par mégarde rouvre
 * exactement le trou que le schéma de synchronisation documente : un champ mal
 * orthographié accepté en silence, et une pièce publiée sans sa couleur, donc
 * absente de la facette.
 */
const articleFields = {
  categoryId: z.string().trim().min(1).max(64),

  /**
   * Le nom de la marque, en saisie libre.
   *
   * Retrouvé-ou-créé côté serveur, sans tenir compte de la casse : « ralph
   * lauren » et « Ralph Lauren » sont la même maison, et deux fiches marque
   * pour un même nom couperaient le catalogue en deux.
   */
  brandName: z.string().trim().max(80).optional(),

  condition: z.enum(ARTICLE_CONDITIONS),
  sizeLabel: z.string().trim().min(1).max(24),

  color: z.enum(ARTICLE_COLORS).optional(),
  material: z.enum(ARTICLE_MATERIALS).optional(),
  fit: z.enum(ARTICLE_FITS).optional(),
  /* L'univers est saisi ICI et nulle part ailleurs : il n'entre pas dans le
     contrat d'import, pour ne pas déplacer l'empreinte de synchronisation de
     tout le stock (voir le commentaire du champ dans prisma/schema.prisma). */
  audience: z.enum(ARTICLE_AUDIENCES).optional(),

  title: z.string().trim().min(3).max(140),

  /**
   * La description rédigée, facultative.
   *
   * Absente, le serveur compose un relevé factuel par langue à partir de la
   * catégorie, de la marque, de la taille, de l'état et des mesures — et la
   * fiche publique le DIT. Présente, elle est écrite dans les huit langues,
   * exactement comme le fait la synchronisation.
   *
   * Ce que l'on ne fait PAS : rédiger en français et composer dans les sept
   * autres. Le drapeau « description composée automatiquement » vit sur
   * l'article, pas sur la ligne de traduction : un tel panachage afficherait
   * « pas encore traduite » au-dessus d'un texte néerlandais réellement
   * néerlandais, en TAISANT qu'il a été composé par une machine. C'est
   * précisément la fausse mention que la fiche publique prend soin d'interdire.
   */
  description: z.string().trim().max(4000).optional(),

  priceEuros: euroText,
  costEuros: euroText,

  weightGrams: z.coerce
    .number()
    .int('le poids se saisit en grammes entiers')
    .positive()
    .max(MAX_WEIGHT_GRAMS),

  /**
   * La négociation est-elle ouverte sur cette pièce ?
   *
   * Dans le formulaire, et pas laissée au défaut du schéma : sans ce champ, une
   * pièce naîtrait négociable sans que personne l'ait décidé.
   */
  allowOffers: z.boolean(),

  /**
   * La baisse automatique s'applique-t-elle ?
   *
   * Également dans le formulaire, et pour une raison plus concrète : le défaut
   * du schéma est `true`, et le balayage périodique se mettrait à démarquer,
   * selon le barème, des pièces dont la boutiquière vient de saisir le coût à
   * la main — sans qu'aucun écran ne lui ait jamais montré l'option.
   */
  autoDropEnabled: z.boolean(),

  /**
   * Provenance interne. Colonne marquée PRIVÉE au schéma.
   *
   * Elle ne sort dans aucune réponse publique. Dire OÙ une boutique
   * s'approvisionne vaut, pour un concurrent, plus cher encore que de savoir ce
   * qu'elle gagne.
   */
  sourcedFrom: z.string().trim().max(120).optional(),

  /** Notes internes. Également privée, jamais rendue au public. */
  internalNotes: z.string().trim().max(2000).optional(),

  measurements: z
    .partialRecord(z.enum(MEASUREMENT_KEYS), measurementText)
    .optional(),
} as const

/** Création : aucune pièce à retrouver, donc rien à comparer. */
export const createArticleSchema = z.object(articleFields).strict()

/**
 * Modification : porte l'horodatage lu au rendu du formulaire.
 *
 * ---------------------------------------------------------------------------
 * À quoi sert `expectedUpdatedAt`
 * ---------------------------------------------------------------------------
 * Le formulaire est rendu à un instant, enregistré à un autre. Entre les deux,
 * trois choses peuvent avoir touché la pièce : une cliente l'a réservée au
 * panier, l'encaissement l'a marquée vendue, ou le balayage périodique en a
 * baissé le prix.
 *
 * Sans cette comparaison, l'enregistrement écraserait tout cela sans le savoir.
 * Le cas le plus silencieux est la baisse de prix : elle se protège elle-même
 * par un UPDATE conditionnel sur le prix lu, mais rien ne protège le sens
 * inverse — le formulaire, rendu avant la baisse, réécrirait l'ancien prix et
 * la baisse disparaîtrait sans laisser de trace.
 *
 * Une date n'est pas un montant : la règle « aucun chiffre reçu du client » ne
 * s'y oppose pas. Elle ne sert d'ailleurs à rien d'autre qu'à être comparée —
 * une valeur forgée fait échouer l'enregistrement, elle n'ouvre rien.
 */
export const updateArticleSchema = z
  .object({
    ...articleFields,
    expectedUpdatedAt: z.coerce.date(),
  })
  .strict()

export type CreateArticleInput = z.infer<typeof createArticleSchema>
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>

/** Les gestes de mise en vente, tels qu'ils arrivent du formulaire. */
export const listingActionSchema = z
  .object({
    articleId: z.string().trim().min(1).max(64),
    action: z.enum(['publish', 'withdraw']),
  })
  .strict()

/** Les gestes sur une photo. */
export const imageActionSchema = z
  .object({
    imageId: z.string().trim().min(1).max(64),
    action: z.enum(['remove', 'up', 'down']),
  })
  .strict()

/**
 * Ranger un lot de pièces dans un univers.
 *
 * ---------------------------------------------------------------------------
 * Le plafond de 200 est une borne de SÉCURITÉ, pas une commodité d'écran
 * ---------------------------------------------------------------------------
 * Une action serveur est une adresse HTTP : rien n'oblige l'appelant à venir
 * du formulaire. Sans borne, un seul envoi peut porter cent mille identifiants,
 * ouvrir une transaction qui les tient tous, et immobiliser la connexion que
 * la production accorde à l'instance — le reste du site avec.
 *
 * La même borne est reposée dans `qualifyArticles`, et ce n'est pas une
 * redondance inutile : le schéma garde l'entrée du formulaire, la fonction
 * garde le domaine contre tout autre appelant à venir.
 *
 * `audience` est validé par la même énumération que la fiche article — une
 * valeur libre créerait une facette fantôme qu'aucune vitrine ne sait ouvrir.
 */
export const qualifyAudienceSchema = z
  .object({
    audience: z.enum(ARTICLE_AUDIENCES),
    articleIds: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(200),
  })
  .strict()
