/**
 * Traduire une ligne d'inventaire vers le contrat de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Pur, et séparé du script pour cette seule raison
 * ---------------------------------------------------------------------------
 * Rien ici ne lit le réseau ni l'environnement. C'est ce qui permet d'exercer
 * la déduction de catégorie sur des libellés réels sans base et sans clé — et
 * c'est la partie du script qui peut se tromper en silence, donc la seule qui
 * mérite vraiment des tests.
 *
 * Les entrées-sorties sont dans `scripts/importer-inventaire.ts`.
 */

import {
  SYNC_RATE_LIMIT,
  SYNC_RATE_WINDOW_SECONDS,
} from '../lib/validation/sync'
import {
  ARTICLE_COLORS,
  type ArticleColor,
  type ArticleCondition,
} from '../lib/domain/vocabulary'

// ---------------------------------------------------------------------------
// Bornes du contrat, reprises pour tronquer AVANT l'envoi
// ---------------------------------------------------------------------------
//
// Les mêmes valeurs sont dans `syncArticleSchema`, qui reste l'autorité : ce
// n'est pas une seconde validation, c'est une politesse. Un titre de 260 signes
// refusé par la boutique demanderait d'aller le raccourcir dans l'application ;
// tronqué ici, la pièce passe, et le rapport le dit.
export const MAX_TITLE = 200
export const MAX_SIZE_LABEL = 32
export const MAX_BRAND = 80
export const MAX_DESCRIPTION = 5000

// ---------------------------------------------------------------------------
// L'inventaire, tel qu'il est réellement rangé
// ---------------------------------------------------------------------------

export interface LigneInventaire {
  id: string
  article: string | null
  marque: string | null
  taille: string | null
  etat: string | null
  couleur: string | null
  description: string | null
  prix_achat: string | number | null
  prix_annonce: string | number | null
  prix_vendu: string | number | null
  en_vente: string | null
}

/** Les colonnes lues, nommément. Ni `vendeur` ni `notes` : le contrat les refuse. */
export const COLONNES =
  'id,article,marque,taille,etat,couleur,description,prix_achat,prix_annonce,prix_vendu,en_vente'

// ---------------------------------------------------------------------------
// Traduction des vocabulaires
// ---------------------------------------------------------------------------

/** Minuscules, sans accents : « Très bon état » et « tres bon etat » se valent. */
export function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * L'état de la pièce.
 *
 * Les clés sont les valeurs RÉELLEMENT présentes dans l'inventaire, relevées
 * avant d'écrire cette table — pas une liste plausible. Les deux formes courtes
 * (« bon », « très bon ») existent bel et bien à côté des longues.
 */
const ETATS: ReadonlyArray<readonly [string, ArticleCondition]> = [
  ['neuf avec etiquette', 'NEW_WITH_TAGS'],
  ['neuf sans etiquette', 'NEW_WITHOUT_TAGS'],
  ['tres bon etat', 'VERY_GOOD'],
  ['tres bon', 'VERY_GOOD'],
  ['bon etat', 'GOOD'],
  ['bon', 'GOOD'],
  ['etat correct', 'FAIR'],
  ['correct', 'FAIR'],
  ['mauvais etat', 'POOR'],
]

export function versEtat(brut: string | null): ArticleCondition | null {
  if (!brut) return null
  const cible = normaliser(brut)
  return ETATS.find(([libelle]) => libelle === cible)?.[1] ?? null
}

/**
 * La couleur, quand elle tombe dans la palette de la boutique.
 *
 * La palette du catalogue compte SEPT teintes, choisies pour la facette : elles
 * doivent rester lisibles en liste et rassembler des pièces qui vont ensemble.
 * L'inventaire, lui, saisit en texte libre — « Bleu ciel », « Rose Fuchsia »,
 * « Noir, Blanc », avec des espaces en fin de chaîne.
 *
 * Ce qui ne tombe pas dans les sept est OMIS, jamais rapproché de force. Ranger
 * « Bleu ciel » sous « marine » ferait apparaître la pièce dans une facette où
 * l'acheteuse ne s'attend pas à la trouver — et le champ est facultatif.
 */
const COULEURS: ReadonlyArray<readonly [string, ArticleColor]> = [
  ['noir', 'noir'],
  ['noire', 'noir'],
  ['bleu marine', 'marine'],
  ['marine', 'marine'],
  ['kaki', 'kaki'],
  ['gris', 'gris'],
  ['bordeaux', 'bordeaux'],
  ['camel', 'camel'],
  ['ecru', 'ecru'],
  ['creme', 'ecru'],
]

export function versCouleur(brut: string | null): ArticleColor | null {
  if (!brut) return null
  const cible = normaliser(brut)
  const trouvee = COULEURS.find(([libelle]) => libelle === cible)?.[1] ?? null

  // Ceinture et bretelles : la table est écrite à la main, la palette est la
  // source de vérité. Si l'une dérive de l'autre, on n'envoie rien plutôt qu'une
  // valeur que la boutique refuserait.
  return trouvee && ARTICLE_COLORS.includes(trouvee) ? trouvee : null
}

/**
 * La catégorie, déduite du libellé de la pièce.
 *
 * ---------------------------------------------------------------------------
 * C'est une DÉDUCTION, et il faut la lire comme telle
 * ---------------------------------------------------------------------------
 * L'inventaire n'a pas de colonne « catégorie ». Le libellé, lui, commence
 * presque toujours par le type de vêtement — « T-shirt Le temps des Cerises… »,
 * « Jean Levi's… ». On s'en sert, faute de mieux.
 *
 * La règle est CONSERVATRICE : ce qui ne correspond à rien n'est pas envoyé, et
 * figure dans le rapport pour être classé à la main. L'alternative — une
 * catégorie fourre-tout — serait pire que l'absence : la catégorie décide aussi
 * du poids par défaut, donc du palier transporteur. Une écharpe rangée en
 * « manteaux » partirait au tarif d'un colis de 1,5 kg, à chaque vente.
 *
 * ---------------------------------------------------------------------------
 * L'ordre est significatif, et se lit en trois étages
 * ---------------------------------------------------------------------------
 * Le premier motif trouvé gagne.
 *
 *  1. Les motifs COMPOSÉS, qui contiennent un motif simple. « Chemise de nuit »
 *     avant « chemise », « short de bain » avant « short » — sinon une nuisette
 *     finirait au rayon chemises et un maillot au rayon shorts.
 *
 *  2. Les noms de vêtement NON AMBIGUS.
 *
 *  3. Les mots qui désignent un vêtement MAIS AUSSI une matière ou une marque,
 *     et qui apparaissent donc à l'intérieur du libellé d'un autre vêtement.
 *     « Short en jean », « Jupe en jean », « Chemise Polo Ralph Lauren ». Testés
 *     en dernier, ils ne gagnent que si aucun vrai nom de vêtement n'est présent.
 *
 * Le troisième étage n'est pas une précaution théorique : c'est un test qui l'a
 * imposé. « Short en jean » tombait dans les pantalons, donc au poids par défaut
 * de 700 g au lieu de 250 g — un palier transporteur de trop, sur chaque colis,
 * pour une famille entière de pièces.
 */
const CATEGORIES_COMPOSEES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['chemise de nuit', 'robe de chambre'], 'lingerie-nuit'],
  [['short de bain', 'maillot de bain'], 'maillots-de-bain'],
]

const CATEGORIES_FRANCHES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['robe'], 'robes'],
  [['chemise', 'chemisier', 'blouse'], 'chemises'],
  [['pull', 'sweat', 'hoodie', 'cardigan', 'gilet'], 'pulls-sweats'],
  [['t-shirt', 'tshirt', 'tee shirt', 'debardeur', 'marcel'], 't-shirts'],
  [['jupe'], 'jupes'],
  [['short', 'bermuda'], 'shorts'],
  [['pantalon', 'chino', 'jogging', 'legging'], 'jeans-pantalons'],
  [['combinaison', 'salopette'], 'combinaisons'],
  [['manteau', 'doudoune', 'parka', 'trench', 'caban'], 'manteaux'],
  [['veste', 'blouson', 'blazer', 'bomber', 'perfecto', 'coupe-vent'], 'vestes-legeres'],
  [
    [
      'chaussure',
      'basket',
      'sneaker',
      'botte',
      'sandale',
      'escarpin',
      'mocassin',
      'ballerine',
    ],
    'chaussures',
  ],
  [['sac', 'cabas', 'pochette', 'sacoche'], 'sacs'],
  [['pyjama', 'nuisette', 'soutien-gorge', 'peignoir'], 'lingerie-nuit'],
  [
    [
      'ceinture',
      'echarpe',
      'foulard',
      'bonnet',
      'casquette',
      'chapeau',
      'cravate',
      'collier',
      'bracelet',
      'lunettes',
    ],
    'accessoires',
  ],
]

const CATEGORIES_AMBIGUES: ReadonlyArray<readonly [readonly string[], string]> = [
  // Matière autant que vêtement.
  [['jean'], 'jeans-pantalons'],
  // Vêtement, mais aussi la moitié d'un nom de maison très présent en friperie.
  [['polo'], 't-shirts'],
]

const CATEGORIES = [
  ...CATEGORIES_COMPOSEES,
  ...CATEGORIES_FRANCHES,
  ...CATEGORIES_AMBIGUES,
]

export function versCategorie(libelle: string | null): string | null {
  if (!libelle) return null
  const cible = normaliser(libelle)

  for (const [motifs, slug] of CATEGORIES) {
    if (motifs.some((motif) => cible.includes(motif))) return slug
  }
  return null
}

/** Les catégories que cette table sait produire — vérifiées contre le catalogue. */
export const CATEGORIES_DEDUITES: readonly string[] = [
  ...new Set(CATEGORIES.map(([, slug]) => slug)),
]

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

/**
 * Des euros décimaux vers des centimes entiers.
 *
 * PostgREST rend les `numeric` sous forme de CHAÎNES — « 14.50 » — pour ne pas
 * perdre de précision dans un flottant. Les multiplier sans arrondir donnerait
 * 1449.9999999999998 pour 14,50 €, et la boutique refuse tout montant qui n'est
 * pas un entier de centimes.
 */
export function versCentimes(brut: string | number | null): number | null {
  if (brut === null || brut === '') return null
  const valeur = typeof brut === 'number' ? brut : Number(brut)
  if (!Number.isFinite(valeur)) return null
  return Math.round(valeur * 100)
}

export function tronquer(valeur: string, maximum: number): string {
  return valeur.length <= maximum ? valeur : valeur.slice(0, maximum).trimEnd()
}

function texteOuRien(brut: string | null, maximum: number): string | undefined {
  const propre = (brut ?? '').trim()
  return propre === '' ? undefined : tronquer(propre, maximum)
}

// ---------------------------------------------------------------------------
// Traduction d'une ligne
// ---------------------------------------------------------------------------

export type Refus =
  | 'categorie-indeduisible'
  | 'sans-etat'
  | 'sans-titre'
  | 'sans-taille'
  | 'sans-prix'
  | 'sans-cout'

export interface PieceTraduite {
  charge: Record<string, unknown>
  categorie: string
  statut: 'AVAILABLE' | 'ARCHIVED'
  tronquee: boolean
}

export function traduire(
  ligne: LigneInventaire,
): PieceTraduite | { refus: Refus } {
  const titre = (ligne.article ?? '').trim()
  if (titre === '') return { refus: 'sans-titre' }

  const categorie = versCategorie(titre)
  if (categorie === null) return { refus: 'categorie-indeduisible' }

  const etat = versEtat(ligne.etat)
  if (etat === null) return { refus: 'sans-etat' }

  const taille = (ligne.taille ?? '').trim()
  if (taille === '') return { refus: 'sans-taille' }

  const priceCents = versCentimes(ligne.prix_annonce)
  if (priceCents === null || priceCents <= 0) return { refus: 'sans-prix' }

  const costCents = versCentimes(ligne.prix_achat)
  if (costCents === null || costCents < 0) return { refus: 'sans-cout' }

  /**
   * Vendue ailleurs, ou retirée de la vente : la pièce quitte le catalogue.
   *
   * `ARCHIVED`, jamais `SOLD`. Le contrat interdit à l'inventaire de prononcer
   * une vente, et il a raison : `SOLD` s'écrit à l'encaissement, il numérote une
   * facture et alimente le registre comptable. Le déclarer depuis l'extérieur
   * inscrirait une vente que personne n'a payée.
   *
   * Une vente conclue sur une autre place de marché n'est pas une vente de la
   * boutique — c'est un retrait de la vente. C'est exactement `ARCHIVED`.
   *
   * Le critère est `prix_vendu`, pas `date_vente` : c'est celui de l'inventaire
   * lui-même, et les deux divergent sur les lignes à demi remplies — une pièce
   * datée mais sans montant est comptée invendue par l'application.
   */
  const vendue = versCentimes(ligne.prix_vendu) !== null
  const enVente = normaliser(ligne.en_vente ?? '') === 'oui'
  const statut = vendue || !enVente ? 'ARCHIVED' : 'AVAILABLE'

  const marque = texteOuRien(ligne.marque, MAX_BRAND)
  const description = texteOuRien(ligne.description, MAX_DESCRIPTION)
  const couleur = versCouleur(ligne.couleur)

  return {
    categorie,
    statut,
    tronquee: titre.length > MAX_TITLE || taille.length > MAX_SIZE_LABEL,
    charge: {
      externalId: ligne.id,
      title: tronquer(titre, MAX_TITLE),
      categorySlug: categorie,
      condition: etat,
      sizeLabel: tronquer(taille, MAX_SIZE_LABEL),
      priceCents,
      costCents,
      status: statut,
      // Ni `weightGrams` ni `images` : l'inventaire n'a ni l'un ni l'autre. Le
      // poids vient du défaut de la catégorie ; l'absence de visuel est
      // acceptée, et la fiche n'est simplement pas indexée tant qu'il manque.
      ...(marque ? { brandName: marque } : {}),
      ...(description ? { description } : {}),
      ...(couleur ? { color: couleur } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Lecture de la réponse de la boutique
// ---------------------------------------------------------------------------

export interface ResultatBoutique {
  externalId: string
  action: string
  reason?: string
  detail?: string
}

export type LectureReponse =
  | { resultats: ResultatBoutique[] }
  | { refusGlobal: { status: number; reason: string; detail: string } }

/**
 * Distinguer un lot REFUSÉ EN BLOC d'un lot traité pièce par pièce.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que cette fonction ferme
 * ---------------------------------------------------------------------------
 * La route rend la même forme dans les deux cas : `{ ok, results }`. Mais quand
 * elle refuse le lot ENTIER — clé absente ou fausse, corps illisible, débit
 * fermé, plus de cent pièces — elle rend `results: []` avec un motif à côté.
 *
 * Le script ne testait que la PRÉSENCE de `results`. Or un tableau vide est
 * `truthy` : le refus passait, aucun tableau ne s'affichait faute de lignes à
 * compter, et l'exécution se terminait sur « aucune écriture n'a eu lieu » —
 * ce qui était vrai, et ne disait rien de la raison.
 *
 * C'est arrivé au premier essai réel : la boutique refusait, et le rapport
 * ressemblait à un succès sans effet. Un refus doit se voir.
 */
export function lireReponse(
  status: number,
  corps: { ok?: boolean; reason?: string; detail?: string; results?: unknown },
): LectureReponse {
  if (!Array.isArray(corps.results)) {
    return {
      refusGlobal: {
        status,
        reason: corps.reason ?? 'reponse-illisible',
        detail: corps.detail ?? 'la boutique n’a pas renvoyé de liste de résultats',
      },
    }
  }

  // Un lot vide ENVOYÉ ne peut pas produire un lot vide REÇU : la route refuse
  // un lot vide en amont. Zéro résultat veut donc toujours dire « refusé en
  // bloc », jamais « rien à faire ».
  if (corps.results.length === 0) {
    return {
      refusGlobal: {
        status,
        reason: corps.reason ?? 'refus-sans-motif',
        detail: corps.detail ?? '',
      },
    }
  }

  return { resultats: corps.results as ResultatBoutique[] }
}

/**
 * Lire une réponse à partir de son TEXTE, pas d'un objet déjà analysé.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que cette fonction ferme
 * ---------------------------------------------------------------------------
 * Le script appelait directement `reponse.json()`. Une réponse SANS corps le
 * faisait échouer sur `SyntaxError: Unexpected end of JSON input`, une pile
 * d'appels internes à Node, et rien qui désigne la cause.
 *
 * Or une réponse vide a une signification très précise ici : la fonction a été
 * TUÉE avant de répondre, faute de temps. C'est arrivé au premier import réel,
 * sur un lot de cent pièces — cent transactions dans le budget par défaut d'une
 * fonction serverless.
 *
 * Une panne doit se lire, pas se deviner dans une trace d'exécution.
 */
export function lireReponseBrute(status: number, texte: string): LectureReponse {
  const propre = texte.trim()

  if (propre === '') {
    return {
      refusGlobal: {
        status,
        reason: 'reponse-vide',
        detail: 'la boutique n’a rien renvoyé',
      },
    }
  }

  let corps: Record<string, unknown>
  try {
    corps = JSON.parse(propre) as Record<string, unknown>
  } catch {
    // Un extrait, pas la page entière : une page d'erreur d'hébergeur fait
    // plusieurs kilo-octets et noierait le rapport.
    return {
      refusGlobal: {
        status,
        reason: 'reponse-non-json',
        detail: propre.slice(0, 200),
      },
    }
  }

  return lireReponse(status, corps)
}

/** Ce qu'il faut aller regarder, selon le refus. */
export function conseilPourRefus({
  status,
  reason,
}: {
  status: number
  reason: string
}): string {
  if (reason === 'shop-in-demo-mode') {
    return 'La boutique tourne encore sur les chiffres du jeu de démonstration et refuse de calculer un prix. Renseignez vos vraies valeurs dans Réglages, puis relancez.'
  }

  /**
   * Un réglage sans ligne en base, ce qui n'est PAS le mode démonstration.
   *
   * Les deux partageaient un motif, et le conseil affiché disait « renseignez
   * vos valeurs dans Réglages » à quelqu'un qui venait de les renseigner —
   * l'enregistrement avait même été refusé pour cette raison exacte, sans que
   * rien ne le relie à ce message.
   *
   * Le détail de la réponse nomme les réglages fautifs : il est affiché juste
   * au-dessus, et le conseil dit quoi en faire.
   */
  if (reason === 'setting-missing') {
    return 'Ce n’est pas le mode démonstration : la ligne du réglage nommé ci-dessus n’existe pas en base. Ouvrez « Réglages » — les réglages absents y sont listés en tête, et ceux qui figurent dans le formulaire sont créés dès le premier enregistrement.'
  }

  // Le motif d'avant, qui confondait les deux. Gardé pour qu'une boutique pas
  // encore redéployée ne retombe pas sur le conseil générique du statut.
  if (reason === 'shop-not-configured') {
    return 'La boutique refuse de calculer un prix : soit elle tourne sur les chiffres de démonstration, soit un réglage n’a aucune ligne en base. Le détail ci-dessus tranche ; dans les deux cas, cela se règle dans « Réglages ».'
  }

  if (reason === 'reponse-vide' || reason === 'reponse-non-json') {
    // Le code compte : un 502 ou un 504 dit « interrompu », un 500 dit
    // « exception ». Les confondre a déjà fait réduire des lots pour un
    // problème qui n'avait rien à voir avec leur taille.
    if (status === 502 || status === 504) {
      /**
       * Ce que le conseil taisait, et qui bloquait autant que le défaut.
       *
       * Un lot interrompu n'est PAS perdu : chaque pièce ouvre sa propre
       * transaction, donc celles traitées avant l'interruption sont écrites. Et
       * une pièce se retrouve par son `externalId` — la renvoyer la met à jour,
       * elle ne la duplique pas.
       *
       * Sans le dire, relancer ressemble à un pari sur un catalogue en double.
       * On n'ose pas, et l'import reste en plan.
       */
      return (
        `La boutique a été interrompue avant de répondre — dépassement de temps sur un lot trop gros. Relancez avec --taille-lot=${Math.ceil(TAILLE_LOT_DEFAUT / 2)}.\n` +
        'Rien n’est perdu et rien ne sera dupliqué : les pièces déjà traitées sont enregistrées, et les renvoyer les met simplement à jour.'
      )
    }
    return 'La boutique a échoué sans rien renvoyer. Ce n’est pas une question de taille de lot : regardez ses journaux d’exécution dans Vercel, filtre « sync ».'
  }

  return conseilPourStatut(status)
}

/** Ce qu'il faut aller regarder, selon le code renvoyé. */
export function conseilPourStatut(status: number): string {
  if (status === 401) {
    return 'SYNC_API_KEY est absente de la boutique, ou différente de celle passée ici. Vérifiez la variable dans Vercel — et redéployez : une variable ajoutée ne s’applique qu’au déploiement suivant.'
  }
  if (status === 429) {
    return 'Débit fermé : trente appels par minute. Attendez une minute et relancez.'
  }
  if (status === 400) {
    return 'La boutique n’a pas compris le corps envoyé. Signalez-le, c’est un défaut du script.'
  }
  if (status >= 500) {
    return 'La boutique a échoué en interne. La cause la plus probable à ce stade : ses réglages sont encore ceux du jeu de démonstration, et elle refuse de calculer un prix en production. Renseignez-les dans Réglages.'
  }
  return 'Consultez les journaux d’exécution de la boutique dans Vercel.'
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

/**
 * Combien de temps attendre entre deux lots, en millisecondes.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le script doit se cadencer LUI-MÊME
 * ---------------------------------------------------------------------------
 * La boutique accorde trente appels par minute. Huit cents pièces par lots de
 * vingt-cinq en demandent trente-trois : envoyés à la file, les trois derniers
 * étaient refusés — après que les trente premiers lots avaient DÉJÀ été écrits.
 * Un import à moitié fait, et un message qui parle de débit.
 *
 * La parade n'est pas de découper l'import à la main, c'est d'attendre. Une
 * marge de dix pour cent absorbe le fait que la fenêtre du compteur ne commence
 * pas au premier appel du script mais à celui qui a créé la clé.
 */
/**
 * Taille de lot par défaut.
 *
 * ---------------------------------------------------------------------------
 * Le MAXIMUM du contrat n'est pas un DÉFAUT
 * ---------------------------------------------------------------------------
 * Le défaut était `MAX_BATCH_SIZE`, soit cent — c'est-à-dire le plus grand lot
 * que la boutique accepte de RECEVOIR, emprunté comme le nombre qu'on lui envoie
 * d'office. Les deux répondent à des questions différentes : l'un dit ce qui
 * tient dans une requête, l'autre ce qui tient dans le temps imparti à une
 * fonction.
 *
 * Ils ne coïncident pas. Chaque pièce ouvre sa PROPRE transaction — c'est ce qui
 * garantit qu'une pièce refusée n'annule pas les autres — et la connexion
 * applicative est réglée à une seule en production. Cent transactions à la file
 * ont dépassé les soixante secondes de la fonction, qui a été tuée sans rien
 * renvoyer.
 *
 * Vingt-cinq est le nombre que le conseil affiché recommandait déjà en cas de
 * dépassement ; il devient le défaut, pour qu'on n'ait pas à buter dessus une
 * première fois pour l'apprendre. Monter reste possible et documenté.
 */
export const TAILLE_LOT_DEFAUT = 25

export const INTERVALLE_ENTRE_LOTS_MS = Math.ceil(
  ((SYNC_RATE_WINDOW_SECONDS * 1000) / SYNC_RATE_LIMIT) * 1.1,
)
