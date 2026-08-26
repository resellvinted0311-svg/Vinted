import type { PricingConfig, AutoDropStage } from '@/lib/domain/pricing'

/**
 * ===========================================================================
 * CES NOMBRES SONT FAUX. Ils ne décrivent aucune boutique réelle.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier existe séparément
 * ---------------------------------------------------------------------------
 * Le seed doit poser des valeurs pour que la boutique tourne en développement :
 * sans marge cible ni barème, aucun prix plancher ne se calcule et le catalogue
 * de démonstration ne se génère pas.
 *
 * Mais ces valeurs-là racontent l'économie d'un commerce. Une marge minimale
 * visée dit ce qu'on gagne par pièce ; une majoration de port dit ce qu'on
 * prend sur chaque colis ; un barème de baisse dit jusqu'où on cède et au bout
 * de combien de temps. Le dépôt étant public, les y laisser reviendrait à
 * publier un compte d'exploitation.
 *
 * D'où ce fichier, et son nom : tout ce qui pourrait ressembler à un chiffre
 * d'affaires vit ICI, en un seul endroit, sous un en-tête qui dit qu'il est
 * faux. Personne ne peut y écrire une vraie valeur en croyant remplir un
 * réglage — et si quelqu'un le fait quand même, la revue verra le fichier
 * changer.
 *
 * ---------------------------------------------------------------------------
 * Où vivent les VRAIES valeurs
 * ---------------------------------------------------------------------------
 * Dans la table `Setting` de la base de production, et nulle part ailleurs.
 * Elles s'y posent depuis l'écran d'administration « Réglages », qui écrit par
 * `writeSettings()` et fait passer `settingsProfile` à `production`.
 *
 * Tant que ce marqueur vaut `development`, `getPricingConfig()` REFUSE de
 * calculer un prix en production. C'est ce qui empêche d'ouvrir la boutique
 * avec les nombres de ce fichier et de vendre à perte sans s'en apercevoir.
 *
 * ---------------------------------------------------------------------------
 * Comment ces valeurs ont été choisies
 * ---------------------------------------------------------------------------
 * Pour être plausibles — un jeu de démonstration incohérent ne teste rien — et
 * rondes, pour qu'on voie au premier coup d'œil qu'elles sortent d'un fichier
 * d'exemple et non d'un relevé comptable.
 */

/**
 * Configuration de prix du jeu de démonstration.
 *
 * Le taux de cotisation et la commission Stripe sont, eux, des TARIFS PUBLICS :
 * le taux micro-entreprise pour la vente de marchandises et le barème affiché
 * du prestataire de paiement. Les cacher n'aurait aucun sens — ils restent donc
 * à des valeurs réalistes, et c'est la marge minimale, seul terme privé de
 * l'inéquation du plancher, qui est fictive.
 */
export const DEMO_PRICING: PricingConfig = {
  contributionRateBps: 1230,
  stripePercentBps: 150,
  stripeFixedCents: 25,
  /** FICTIF. 5,00 € — un chiffre rond, choisi pour ne ressembler à rien. */
  minMarginCents: 500,
}

/** FICTIF. Majoration appliquée au coût transporteur, en pourcentage. */
export const DEMO_SHIPPING_MARKUP_PERCENT = 15

/**
 * Poids de l'emballage, en grammes.
 *
 * Pas un secret — c'est le poids d'une pochette, et la documentation de
 * synchronisation l'annonce déjà au partenaire. Il vit ici parce que le seed en
 * a besoin DEUX fois : pour écrire le réglage, et pour estimer le port qui entre
 * dans le prix plancher. Les deux copies avaient divergé une fois, la seconde
 * étant un `80` écrit en dur au milieu d'un calcul.
 */
export const DEMO_PACKAGING_WEIGHT_GRAMS = 80

/**
 * FICTIF. Où se place le refus automatique d'offre, en proportion du plancher.
 *
 * Une valeur sous 1 signifie qu'une offre légèrement déficitaire est acceptée
 * pour arbitrage manuel au lieu d'être rejetée — c'est une politique
 * commerciale, et elle se lit dans ce seul nombre.
 */
export const DEMO_MIN_OFFER_RATIO = 0.95

/** FICTIF. Barème de baisse automatique du jeu de démonstration. */
export const DEMO_AUTO_DROP_SCHEDULE: AutoDropStage[] = [
  { days: 45, percent: 5 },
  { days: 90, percent: 15 },
]

/**
 * FICTIF. Fourchette de prix d'achat des pièces de démonstration, en centimes.
 *
 * Une fourchette de sourcing donne l'ordre de grandeur de ce qu'on paie ses
 * pièces. Celle-ci est large exprès : elle sert à produire un catalogue varié,
 * pas à décrire un approvisionnement.
 */
export const DEMO_COST_RANGE = { minCents: 200, maxCents: 1500 } as const

/**
 * FICTIF. Provenances des pièces de démonstration.
 *
 * `Article.sourcedFrom` est marquée `/// PRIVÉ` au schéma : elle ne sort dans
 * aucune réponse publique. Elle n'a pas pour autant à porter de vrais noms dans
 * le dépôt — dire OÙ une boutique s'approvisionne est, pour un concurrent, plus
 * utile encore que de savoir ce qu'elle gagne.
 *
 * Ces lieux sont donc inventés. Aucun ne désigne un endroit existant.
 */
export const DEMO_SOURCING_PLACES = [
  'brocante des Deux-Ponts',
  'vide-grenier de Trifouillis',
  'dépôt-vente du Vieux Marché',
  'réderie de Sainte-Aubine',
  'friperie de la rue Basse',
] as const
