function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (production) return `https://${production}`

  const deployment = process.env.VERCEL_URL
  if (deployment) return `https://${deployment}`

  return 'http://localhost:3000'
}

/**
 * L'authentification est-elle configurée ?
 *
 * Sans secret de signature, Auth.js refuse de traiter la moindre requête. On
 * préfère le constater et neutraliser proprement la connexion plutôt que de
 * laisser une page renvoyer une erreur 500 — et surtout plutôt que d'inventer
 * un secret de repli, qui rendrait les sessions falsifiables.
 */
/**
 * La négociation est-elle proposée sur ce déploiement ?
 *
 * ---------------------------------------------------------------------------
 * Éteinte par défaut, et c'est une décision de la boutique
 * ---------------------------------------------------------------------------
 * Toute la mécanique existe — dépôt d'offre, prix plancher, contre-proposition,
 * échéances, e-mails, file de la régie. La boutique a choisi de ne pas la
 * proposer pour l'instant. Elle reste donc en place, testée, et s'allume en
 * posant `OFFERS_ENABLED=1` puis en redéployant.
 *
 * Une variable et non un réglage de la régie : c'est un choix qu'on fait une
 * fois, pas un nombre qu'on ajuste. Le redéploiement qu'elle demande a un
 * avantage : il régénère les fiches en cache, qui sinon continueraient de
 * montrer — ou de cacher — le formulaire jusqu'à leur échéance.
 *
 * ---------------------------------------------------------------------------
 * Ce que l'interrupteur éteint, et ce qu'il laisse
 * ---------------------------------------------------------------------------
 * Il empêche toute NOUVELLE offre — le formulaire disparaît des fiches, et le
 * serveur refuse de son côté, parce qu'un formulaire masqué n'est pas une
 * protection : une Server Action est un POST que n'importe qui peut former.
 *
 * Il laisse se conclure ce qui était en cours si l'on éteint après avoir
 * allumé : une contre-proposition déjà envoyée peut encore recevoir sa réponse.
 * Couper une négociation au milieu laisserait une personne devant un prix
 * promis qu'elle ne peut plus accepter.
 */
export function isNegotiationEnabled(): boolean {
  return process.env.OFFERS_ENABLED?.trim() === '1'
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET)
}

/**
 * Identité de la boutique.
 *
 * Le nom n'est jamais écrit en dur ailleurs que dans ce fichier : il apparaît
 * dans les métadonnées, les 8 fichiers de traduction, les emails et les
 * mentions légales. Un changement de nom se fait ici et dans /messages.
 */
export const SITE = {
  name: 'Nina & Diego',
  /** Baseline affichée sous le nom, en plus petit. */
  tagline: 'La seconde main à portée de main',
  /**
   * Domaine du site.
   *
   * Déduit de l'environnement Vercel à défaut d'être fourni, pour qu'un
   * déploiement fonctionne sans configuration : les URL canoniques, les
   * balises hreflang et les images Open Graph pointent alors sur le domaine
   * réel plutôt que sur localhost.
   *
   * `VERCEL_PROJECT_PRODUCTION_URL` est le domaine stable du projet ;
   * `VERCEL_URL` change à chaque déploiement et ne sert que de repli.
   */
  url: resolveSiteUrl(),
  /** Devise unique en V1. L'abstraction existe, elle n'est pas activée. */
  currency: 'EUR',
} as const

/**
 * Identité légale — vendeur professionnel constitué en SOCIÉTÉ (SAS).
 *
 * Toutes ces valeurs sortent de l'environnement : elles figurent sur les
 * mentions légales, les CGV et chaque facture. Une valeur manquante doit
 * empêcher l'affichage du bloc concerné plutôt qu'afficher un texte inventé.
 *
 * ---------------------------------------------------------------------------
 * Le modèle avait été écrit pour une micro-entreprise
 * ---------------------------------------------------------------------------
 * Il ne demandait que le nom, le SIRET, l'adresse et l'e-mail. Pour une
 * société, le site se serait donc déclaré « complet » en omettant cinq
 * mentions obligatoires — et c'est la pire façon d'être incomplet, parce que
 * rien ne le signale.
 *
 * Ce qu'exige la loi, et où (sources relevées le 24 octobre 2026) :
 *  - LCEN, article 1-1 I 2° (l'ancien article 6 III, déplacé par la loi SREN
 *    n° 2024-449, art. 22) : dénomination, siège social, TÉLÉPHONE, numéro
 *    d'inscription au RCS et CAPITAL social. 3° : le DIRECTEUR DE LA
 *    PUBLICATION. 4° : nom, adresse et téléphone de l'HÉBERGEUR.
 *    https://www.senat.fr/leg/tas23-103.html ;
 *    https://entreprendre.service-public.gouv.fr/vosdroits/F37351?profil=societe
 *  - Code de commerce, article R123-237 : sur le site, « RCS » suivi de la
 *    ville du greffe, et le numéro SIREN ; sur la facture, la FORME juridique
 *    et le capital. https://greffe-tc-paris.fr/procedure_sheet_download/mentionspapiersaffaire ;
 *    https://entreprendre.service-public.gouv.fr/vosdroits/F31808?profil=societe
 */
export const LEGAL = {
  companyName: process.env.LEGAL_COMPANY_NAME ?? '',
  /** « SAS », « SASU »… tel qu'il figure sur l'extrait Kbis. */
  legalForm: process.env.LEGAL_FORM ?? '',
  /** Montant écrit tel qu'il doit s'afficher : « 1 000 € ». */
  shareCapital: process.env.LEGAL_CAPITAL ?? '',
  siret: process.env.LEGAL_SIRET ?? '',
  /** Ville du greffe d'immatriculation, écrite comme sur le Kbis. */
  rcsCity: process.env.LEGAL_RCS_CITY ?? '',
  /** Adresse du SIÈGE SOCIAL. */
  address: process.env.LEGAL_ADDRESS ?? '',
  email: process.env.LEGAL_EMAIL ?? '',
  phone: process.env.LEGAL_PHONE ?? '',
  /** Nom de la personne physique qui répond de ce qui est publié. */
  publicationDirector: process.env.LEGAL_PUBLICATION_DIRECTOR ?? '',
  /**
   * Numéro de TVA intracommunautaire. FACULTATIF : une société en franchise
   * en base n'en a pas toujours ; s'il existe, il doit figurer.
   */
  vatNumber: process.env.LEGAL_VAT_NUMBER ?? '',
  mediatorName: process.env.LEGAL_MEDIATOR_NAME ?? '',
  mediatorAddress: process.env.LEGAL_MEDIATOR_ADDRESS ?? '',
  mediatorUrl: process.env.LEGAL_MEDIATOR_URL ?? '',
  /**
   * Franchise en base de TVA. La mention est obligatoire sur chaque facture.
   *
   * Une SAS PEUT en bénéficier, dans les mêmes seuils qu'une entreprise
   * individuelle (F21746, « Forme juridique : Société », vérifiée le
   * 1er janvier 2026). Écrite en dur, et délibérément : le site ne calcule
   * aucune TVA. Une variable qui permettrait de la passer à `false` ferait
   * émettre des factures sans la mention ET sans la taxe — fausses dans les
   * deux sens. Le jour où la société y est assujettie, c'est un chantier de
   * code (calcul, ventilation, numéro obligatoire), pas un réglage.
   */
  vatExempt: true,
  vatExemptionNotice: 'TVA non applicable, art. 293 B du CGI',
} as const

/**
 * L'hébergeur du site, mention obligatoire (LCEN, art. 1-1 I 4°).
 *
 * Écrit ici et non en variable : ce n'est pas une donnée de la boutique, c'est
 * un fait de l'infrastructure, le même pour tout déploiement de ce dépôt.
 *
 * Sources ouvertes le 24 octobre 2026 : l'adresse figure dans
 * https://vercel.com/legal/privacy-policy (« Contact Us ») et
 * https://vercel.com/legal/terms. Le téléphone est le SEUL que Vercel publie,
 * sous son agent DMCA (https://vercel.com/legal/dmca-policy) : aucun standard
 * général n'apparaît sur ses pages légales. S'il change, c'est ici.
 */
export const HOSTING = {
  name: 'Vercel Inc.',
  address: '440 N Barranca Ave #4133, Covina, CA 91723, États-Unis',
  phone: '+1 559 288 7060',
  url: 'https://vercel.com',
} as const

/**
 * Les mentions d'identité, et la variable qui porte chacune.
 *
 * Une seule liste décide à la fois de ce qui est EXIGÉ et de ce qui est
 * NOMMÉ quand cela manque : l'écran de mise en service et les pages en attente
 * disent exactement quelles variables poser, au lieu d'une liste recopiée en
 * toutes lettres qui finirait par oublier la dernière ajoutée.
 *
 * Le numéro de TVA n'y est pas : il est facultatif. Le médiateur non plus —
 * voir `hasMediator()`.
 */
const IDENTITE_LEGALE = [
  ['companyName', 'LEGAL_COMPANY_NAME'],
  ['legalForm', 'LEGAL_FORM'],
  ['shareCapital', 'LEGAL_CAPITAL'],
  ['siret', 'LEGAL_SIRET'],
  ['rcsCity', 'LEGAL_RCS_CITY'],
  ['address', 'LEGAL_ADDRESS'],
  ['email', 'LEGAL_EMAIL'],
  ['phone', 'LEGAL_PHONE'],
  ['publicationDirector', 'LEGAL_PUBLICATION_DIRECTOR'],
] as const satisfies readonly (readonly [keyof typeof LEGAL, string])[]

const MEDIATEUR = [
  ['mediatorName', 'LEGAL_MEDIATOR_NAME'],
  ['mediatorAddress', 'LEGAL_MEDIATOR_ADDRESS'],
  ['mediatorUrl', 'LEGAL_MEDIATOR_URL'],
] as const satisfies readonly (readonly [keyof typeof LEGAL, string])[]

function absentes(
  liste: readonly (readonly [keyof typeof LEGAL, string])[],
): string[] {
  return liste
    .filter(([champ]) => !String(LEGAL[champ]).trim())
    .map(([, variable]) => variable)
}

/** Les NOMS des variables d'identité non renseignées. Jamais leurs valeurs. */
export function missingLegalKeys(): string[] {
  return absentes(IDENTITE_LEGALE)
}

/** Une valeur légale non renseignée ne doit jamais être remplacée par un texte plausible. */
export function hasLegalIdentity(): boolean {
  return missingLegalKeys().length === 0
}

/**
 * Le SIREN, tiré du SIRET.
 *
 * Le SIRET est le SIREN suivi des cinq chiffres de l'établissement : le
 * déduire évite une variable de plus, et surtout deux valeurs qui pourraient
 * se contredire. Les espaces saisis par commodité sont ignorés.
 */
export function sirenFromSiret(siret: string): string {
  const chiffres = siret.replace(/\D/g, '').slice(0, 9)
  return chiffres.replace(/(\d{3})(?=\d)/g, '$1 ')
}

/** « RCS Lille Métropole 123 456 789 », la forme attendue (F31190). */
export function rcsMention(): string {
  return `RCS ${LEGAL.rcsCity} ${sirenFromSiret(LEGAL.siret)}`
}

/**
 * Le médiateur de la consommation est-il renseigné ?
 *
 * Son adhésion est OBLIGATOIRE pour tout commerce en ligne B2C français
 * (article L612-1 du code de la consommation), et ses coordonnées doivent
 * figurer sur le site et dans les CGV : « nom, adresse postale et adresse du
 * site internet » (F33338, vérifiée le 16 octobre 2026). Le nom seul ne
 * suffisait pas, et c'est pourtant tout ce que ce test exigeait.
 *
 * Il est vérifié à part, et jamais fondu dans `hasLegalIdentity()`. Deux
 * raisons, opposées :
 *
 *  - l'inclure masquerait tout le bloc d'identité tant qu'il manque, alors que
 *    le nom, le SIRET et l'adresse sont exacts et utiles à afficher ;
 *  - ne pas le vérifier du tout — ce qui était le cas — laissait le site
 *    publier des mentions légales PRÉSENTÉES COMME COMPLÈTES en omettant en
 *    silence un élément obligatoire. C'est le pire des deux.
 *
 * Séparés, l'absence se voit et se dit, sans rien cacher de ce qui est connu.
 */
export function hasMediator(): boolean {
  return missingMediatorKeys().length === 0
}

/** Les NOMS des variables du médiateur non renseignées. */
export function missingMediatorKeys(): string[] {
  return absentes(MEDIATEUR)
}

/**
 * L'identité légale est-elle réellement COMPLÈTE ?
 *
 * À utiliser avant toute vente réelle, jamais pour décider d'un affichage.
 */
export function isLegallyComplete(): boolean {
  return hasLegalIdentity() && hasMediator()
}
