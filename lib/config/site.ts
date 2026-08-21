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
 * Identité légale — vendeur professionnel en micro-entreprise.
 *
 * Toutes ces valeurs sortent de l'environnement : elles figurent sur les
 * mentions légales, les CGV et chaque facture. Une valeur manquante doit
 * empêcher l'affichage du bloc concerné plutôt qu'afficher un texte inventé.
 */
export const LEGAL = {
  companyName: process.env.LEGAL_COMPANY_NAME ?? '',
  siret: process.env.LEGAL_SIRET ?? '',
  address: process.env.LEGAL_ADDRESS ?? '',
  email: process.env.LEGAL_EMAIL ?? '',
  mediatorName: process.env.LEGAL_MEDIATOR_NAME ?? '',
  mediatorUrl: process.env.LEGAL_MEDIATOR_URL ?? '',
  /**
   * Franchise en base de TVA. La mention est obligatoire sur chaque facture.
   * Bascule prévue si le régime change (dépassement de seuil).
   */
  vatExempt: true,
  vatExemptionNotice: 'TVA non applicable, art. 293 B du CGI',
} as const

/** Une valeur légale non renseignée ne doit jamais être remplacée par un texte plausible. */
export function hasLegalIdentity(): boolean {
  return Boolean(LEGAL.companyName && LEGAL.siret && LEGAL.address && LEGAL.email)
}

/**
 * Le médiateur de la consommation est-il renseigné ?
 *
 * Son adhésion est OBLIGATOIRE pour tout commerce en ligne B2C français
 * (article L612-1 du code de la consommation), et ses coordonnées doivent
 * figurer sur le site et dans les CGV.
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
  return Boolean(LEGAL.mediatorName)
}

/**
 * L'identité légale est-elle réellement COMPLÈTE ?
 *
 * À utiliser avant toute vente réelle, jamais pour décider d'un affichage.
 */
export function isLegallyComplete(): boolean {
  return hasLegalIdentity() && hasMediator()
}
