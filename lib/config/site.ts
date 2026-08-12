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
  /** Domaine de production — à remplacer une fois le nom de domaine acquis. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
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
