/**
 * Zones et grille tarifaire.
 *
 * Règle absolue : le prix du port dépend du POIDS et de la ZONE, jamais d'une
 * distance ni de coordonnées géographiques.
 *
 * `priceCents` est le TARIF TRANSPORTEUR (le coût). Le prix facturé à
 * l'acheteur en est dérivé par Setting.shippingMarkupPercent — voir
 * computeChargedShippingCents(). Ne jamais confondre les deux.
 *
 * ---------------------------------------------------------------------------
 * LES MONTANTS DE `RATES` SONT LES TARIFS PUBLICS RÉELS — plus des repères
 * ---------------------------------------------------------------------------
 * Ils étaient fictifs, et trop bas : 9,80 € annoncés pour un colis Colissimo de
 * 500 g vers l'Union européenne, quand La Poste en demande 14,99 € ; 8,90 € pour
 * 5 kg en point relais, quand Mondial Relay en demande 15,99 €. Une boutique
 * mise en ligne avec ces montants aurait perdu de l'argent sur chaque colis
 * envoyé hors de France, et sur chaque colis lourd.
 *
 * Ils sont remplacés par les tarifs PUBLICS publiés par les transporteurs,
 * relevés sur leurs sites, et datés ligne à ligne plus bas :
 *
 *  - Colissimo : laposte.fr, grilles « Colissimo en ligne » et « tarifs
 *    postaux colis », en vigueur au 1er janvier 2026 ;
 *  - Mondial Relay : mondialrelay.fr, page « tarifs expéditions », grille
 *    applicable au 15 juin 2026. Le site refuse la lecture automatisée ; la
 *    grille a été lue par l'index d'un moteur de recherche, sur la page
 *    officielle, et recoupée par deux requêtes distinctes.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi des tarifs réels ont le droit d'être ici, et pas les négociés
 * ---------------------------------------------------------------------------
 * L'interdiction tenue jusqu'ici visait les tarifs NÉGOCIÉS, et elle tient
 * toujours : un tarif obtenu par contrat est une donnée d'exploitation, et ce
 * dépôt est public.
 *
 * Un tarif PUBLIC, lui, est public. N'importe qui le lit sur le site du
 * transporteur, et n'importe quel acheteur peut le comparer au port facturé
 * pour en déduire la majoration. L'écrire ici ne révèle rien qui ne le soit
 * déjà — et laisser à la place un chiffre inventé faisait facturer un port faux.
 *
 * Les tarifs négociés — compte professionnel Mondial Relay « Offre Start »,
 * contrat Colissimo — se saisissent dans la régie, écran « Tarifs de port ».
 * Ils n'ont rien à faire dans ce fichier.
 *
 * ---------------------------------------------------------------------------
 * Tarifs PARTICULIER, donc plutôt hauts — et c'est délibéré
 * ---------------------------------------------------------------------------
 * Ce sont les prix payés sans contrat. Un compte professionnel les fait
 * baisser — Mondial Relay annonce son offre pro dès 3,09 € HT. Partir du tarif
 * particulier garantit que la boutique ne facture jamais un port inférieur à
 * ce qu'elle paie ; le corriger à la baisse se fait dans la régie, le jour où
 * le contrat existe.
 *
 * ---------------------------------------------------------------------------
 * Chaque palier couvre TOUTE sa tranche, au prix le plus haut de la tranche
 * ---------------------------------------------------------------------------
 * Un palier de la boutique dit « jusqu'à X g ». Son prix est celui que le
 * transporteur demande pour un colis de X g exactement — la borne haute. Les
 * grilles étant croissantes, c'est le prix le plus élevé de la tranche : un
 * colis plus léger n'est jamais facturé moins que ce qu'il coûte.
 *
 * Là où une source hésite — Mondial Relay entre 4 et 5 kg, où deux parties de
 * la même page ne disent pas la même chose — on retient l'interprétation la
 * plus chère. Se tromper vers le haut coûte un peu de port ; se tromper vers le
 * bas coûte la marge de la pièce.
 *
 * ---------------------------------------------------------------------------
 * Ces montants VIEILLISSENT, et ce fichier ne les met pas à jour en production
 * ---------------------------------------------------------------------------
 * Mondial Relay a changé ses tarifs deux fois en 2026 (16 février, 15 juin).
 * Corriger ce fichier n'atteint QUE les bases neuves : en production, le seed
 * ne réécrit jamais un prix existant — c'est la régie qui fait foi, et c'est
 * là qu'un changement de tarif se reporte.
 *
 * Les DÉLAIS de livraison, en revanche, sont publics — ils s'affichent au
 * tunnel de commande — et les ZONES ne sont pas un secret non plus.
 */

export interface ZoneSeed {
  code: string
  name: string
  countries: string[]
  postalPrefixes?: string[]
  freeShippingThresholdCents: number | null
  position: number
  requiresCustoms?: boolean
}

export const ZONES: ZoneSeed[] = [
  {
    code: 'FR',
    name: 'France métropolitaine',
    countries: ['FR'],
    freeShippingThresholdCents: 4000,
    position: 1,
  },
  {
    // La Corse est discriminée par préfixe postal, prioritaire sur le pays.
    code: 'FR_CORSE',
    name: 'Corse',
    countries: ['FR'],
    postalPrefixes: ['20'],
    freeShippingThresholdCents: null,
    position: 2,
  },
  {
    code: 'FR_DOM',
    name: 'Outre-mer',
    countries: ['FR'],
    // 971 à 978 : Guadeloupe, Martinique, Guyane, La Réunion, Saint-Pierre-et-
    // Miquelon, Mayotte, Saint-Barthélemy, Saint-Martin.
    //
    // 984, 986, 987, 988 ajoutés après relecture : les Terres australes,
    // Wallis-et-Futuna, la Polynésie française et la Nouvelle-Calédonie portent
    // elles aussi le code pays FR. Absentes de cette liste, elles retombaient
    // sur la zone générique — donc Nouméa facturée au tarif de Paris, à un
    // tiers du coût réel, sans qu'aucune erreur ne le signale.
    postalPrefixes: [
      '971',
      '972',
      '973',
      '974',
      '975',
      '976',
      '977',
      '978',
      '984',
      '986',
      '987',
      '988',
    ],
    freeShippingThresholdCents: null,
    position: 3,
    requiresCustoms: true,
  },
  {
    code: 'EU1',
    name: 'Union européenne — zone 1',
    countries: ['BE', 'LU', 'NL', 'DE', 'ES', 'IT', 'PT', 'AT'],
    freeShippingThresholdCents: 8000,
    position: 4,
  },
  {
    code: 'EU2',
    name: 'Union européenne — zone 2',
    countries: [
      'IE',
      'DK',
      'SE',
      'FI',
      'PL',
      'CZ',
      'SK',
      'HU',
      'RO',
      'BG',
      'GR',
      'HR',
      'SI',
      'EE',
      'LV',
      'LT',
      'MT',
      'CY',
    ],
    // Jamais de port offert : les tarifs y sont trop élevés pour un panier
    // moyen de 10 à 20 €.
    freeShippingThresholdCents: null,
    position: 5,
  },
  {
    code: 'EUROPE_NON_EU',
    name: 'Europe hors UE',
    countries: ['CH', 'GB', 'NO'],
    freeShippingThresholdCents: null,
    position: 6,
    // Déclaration douanière CN22 / CN23 obligatoire.
    requiresCustoms: true,
  },
]

export interface RateSeed {
  zoneCode: string
  carrierCode: string
  serviceCode: string
  label: string
  maxWeightGrams: number
  /** Coût transporteur, hors majoration. */
  priceCents: number
  deliveryDaysMin: number
  deliveryDaysMax: number
  requiresServicePoint?: boolean
}

/**
 * Une grille de transporteur, palier par palier.
 *
 * Chaque transporteur garde SES paliers. La version précédente imposait quatre
 * paliers communs à tous — 500 g, 1, 2 et 5 kg — et c'était faux deux fois :
 * Colissimo facture un colis de 250 g moins cher qu'un colis de 500 g, et
 * Mondial Relay fait 3 et 4 kg au même prix que 2 kg ou presque. Avec des
 * paliers communs, un t-shirt de 200 g envoyé en Colissimo payait le tarif
 * 500 g, et un manteau de 2,5 kg envoyé en point relais payait celui de 5 kg —
 * le double.
 *
 * Le calcul du devis le permet : il choisit, transporteur par transporteur, le
 * plus petit palier qui contient le colis (`quoteShipping`).
 */
function grille(
  zoneCode: string,
  carrierCode: string,
  serviceCode: string,
  label: string,
  /** [poids maximal en grammes, coût en centimes], par poids croissant. */
  paliers: ReadonlyArray<readonly [number, number]>,
  deliveryDaysMin: number,
  deliveryDaysMax: number,
  requiresServicePoint = false,
): RateSeed[] {
  return paliers.map(([maxWeightGrams, priceCents]) => ({
    zoneCode,
    carrierCode,
    serviceCode,
    label,
    maxWeightGrams,
    priceCents,
    deliveryDaysMin,
    deliveryDaysMax,
    requiresServicePoint,
  }))
}

/**
 * Colissimo, livraison à domicile, France métropolitaine.
 *
 * Source : laposte.fr, « Colissimo en ligne », tarifs 2026. La même grille
 * s'applique à la Corse, à Monaco et à Andorre — La Poste les range
 * explicitement sous « France métropolitaine ».
 */
const COLISSIMO_FRANCE = [
  [250, 549],
  [500, 759],
  [750, 929],
  [1000, 959],
  [2000, 1119],
  [5000, 1739],
  [10000, 2529],
  [15000, 3199],
  [30000, 3959],
] as const

/**
 * Colissimo vers l'Union européenne.
 *
 * Source : laposte.fr, « Colissimo International », tarifs 2026. Une seule
 * grille pour tous les États membres — la Suisse, le Liechtenstein, Saint-Marin
 * et le Vatican y sont rattachés aussi. Les deux zones UE de la boutique ont
 * donc le même prix ; elles ne se distinguent que par leurs délais.
 *
 * Le palier de 20 kg et celui de 30 kg sont au même prix chez La Poste : seul
 * le second est retenu, il couvre les deux.
 */
const COLISSIMO_UE = [
  [500, 1499],
  [1000, 1939],
  [2000, 2219],
  [5000, 2859],
  [10000, 4699],
  [15000, 6799],
  [30000, 8799],
] as const

export const RATES: RateSeed[] = [
  // ---- France métropolitaine ---------------------------------------------
  /*
    Mondial Relay, point relais et locker.

    Source : mondialrelay.fr, page « tarifs expéditions », grille applicable au
    15 juin 2026, tarif particulier TTC. Relevés : 0,25 kg et 0,5 kg à 4,15 € ;
    1 kg à 5,99 € ; 2 kg et 3 kg à 7,99 € ; 4 kg à 9,99 € ; 5, 7 et 10 kg à
    15,99 € ; 15 et 25 kg à 25,99 €.

    D'où les paliers de 3 kg et de 4 kg, que la grille commune n'avait pas : un
    manteau de 2,5 kg coûte 7,99 € en point relais, pas 15,99 €.

    Point d'incertitude, tranché vers le haut : une donnée structurée de la
    même page annonce « de 2 à 4 kg » à 7,99 €, quand le tableau dit 9,99 € pour
    4 kg. Le tableau est retenu — c'est le plus cher des deux.

    Délais : 3 à 5 jours ouvrés, annoncés par Mondial Relay. La grille
    précédente en promettait 2 à 4 : c'était une promesse que le transporteur ne
    fait pas.

    Plafond : 25 kg, la limite du point relais.
  */
  ...grille(
    'FR',
    'mondial_relay',
    'MR_RELAY',
    'Point relais',
    [
      [500, 415],
      [1000, 599],
      [3000, 799],
      [4000, 999],
      [10000, 1599],
      [25000, 2599],
    ],
    3,
    5,
    true,
  ),
  ...grille(
    'FR',
    'colissimo',
    'COL_HOME',
    'À domicile',
    COLISSIMO_FRANCE,
    2,
    3,
  ),

  // ---- Corse --------------------------------------------------------------
  /*
    Même grille Colissimo que la métropole : La Poste range la Corse sous
    « France métropolitaine ». La grille précédente la facturait plus cher, sur
    un écart que le transporteur ne pratique pas.

    La zone reste distincte pour ses DÉLAIS, et parce que la disponibilité de
    Mondial Relay en Corse n'a pas été vérifiée : il n'y est pas proposé plutôt
    que d'y être proposé à un prix supposé.
  */
  ...grille(
    'FR_CORSE',
    'colissimo',
    'COL_HOME',
    'À domicile',
    COLISSIMO_FRANCE,
    3,
    6,
  ),

  // ---- Outre-mer ----------------------------------------------------------
  /*
    Colissimo Outre-mer, groupe A : Guadeloupe, Martinique, Guyane, La Réunion,
    Mayotte, Saint-Pierre-et-Miquelon, Saint-Martin, Saint-Barthélemy.

    Source : laposte.fr, « Colissimo en ligne », tarifs 2026.

    Les préfixes postaux de la zone (971 à 978) correspondent exactement à ce
    groupe. Le groupe B — Polynésie, Nouvelle-Calédonie, Wallis-et-Futuna — est
    nettement plus cher (33,49 € contre 25,89 € à 2 kg) ; ses préfixes, 987 et
    988, ne sont PAS dans la zone, et c'est voulu : y ajouter un territoire du
    groupe B sans lui donner sa grille le ferait facturer au prix du groupe A.
  */
  ...grille(
    'FR_DOM',
    'colissimo',
    'COL_HOME',
    'À domicile',
    [
      [500, 1202],
      [1000, 1900],
      [2000, 2589],
      [5000, 3890],
      [10000, 6232],
      [15000, 13020],
      [30000, 14302],
    ],
    5,
    10,
  ),

  // ---- Union européenne ---------------------------------------------------
  /*
    Colissimo seul.

    Mondial Relay dessert une partie de l'UE en point relais — Belgique,
    Luxembourg, Pays-Bas, Espagne, Portugal, Italie, Pologne — à des prix bien
    plus bas que Colissimo (de l'ordre de 4,60 € pour 500 g vers la Belgique).
    Il n'est PAS proposé ici, et ce n'est pas un oubli :

     - aucune grille complète et cohérente n'a pu être relevée — le site
       refuse la lecture automatisée, et les extraits obtenus se contredisent
       d'une page à l'autre ;
     - la zone 1 mélange des pays desservis en point relais et d'autres qui ne
       le sont pas (Allemagne, Autriche : domicile uniquement). Un prix unique
       pour la zone aurait proposé un point relais là où il n'en existe pas.

    Le proposer demanderait des zones découpées par pays, avec une grille
    vérifiée pour chacun. En attendant, l'acheteuse européenne paie le tarif
    Colissimo — plus cher, mais exact.
  */
  ...grille('EU1', 'colissimo', 'COL_HOME', 'À domicile', COLISSIMO_UE, 3, 5),
  ...grille('EU2', 'colissimo', 'COL_HOME', 'À domicile', COLISSIMO_UE, 4, 8),

  // ---- Europe hors UE -----------------------------------------------------
  /*
    Une zone, trois pays, trois prix chez La Poste — et donc le plus haut.

    Source : laposte.fr, « Colissimo en ligne », tarifs 2026. Pour 500 g :
    Suisse 14,99 € (rattachée à la grille UE), Royaume-Uni 18,99 €, Norvège
    23,79 €. Une zone ne porte qu'un prix par palier ; on retient le plus haut,
    palier par palier, pour ne jamais facturer à un pays moins que son coût.

    Le prix à payer est connu : une acheteuse suisse paie près de 9 € de port de
    trop. Le corriger demande de découper la zone par pays.

    Plafond : 20 kg. La Norvège n'est pas desservie au-delà ; un palier de 30 kg
    sur cette zone aurait proposé un envoi impossible vers l'un de ses pays.
  */
  ...grille(
    'EUROPE_NON_EU',
    'colissimo',
    'COL_HOME',
    'À domicile',
    [
      [500, 2379],
      [1000, 2839],
      [2000, 3109],
      [5000, 3989],
      [10000, 6609],
      [15000, 8959],
      [20000, 10949],
    ],
    5,
    10,
  ),
]

/**
 * Coût transporteur le moins cher pour un poids donné en France.
 * Sert au calcul du plancher de prix à la création d'un article.
 */
export function cheapestFrenchCarrierCostCents(weightGrams: number): number {
  const candidates = RATES.filter(
    (rate) => rate.zoneCode === 'FR' && rate.maxWeightGrams >= weightGrams,
  ).map((rate) => rate.priceCents)

  if (candidates.length === 0) {
    // Au-delà du palier le plus lourd : on retient le tarif le plus élevé
    // plutôt que d'inventer une extrapolation.
    return Math.max(
      ...RATES.filter((r) => r.zoneCode === 'FR').map((r) => r.priceCents),
    )
  }

  return Math.min(...candidates)
}
