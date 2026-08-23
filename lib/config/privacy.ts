/**
 * Registre des traitements — la source unique.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier plutôt qu'une page de texte
 * ---------------------------------------------------------------------------
 * Une politique de confidentialité rédigée à la main dérive du code en
 * quelques semaines : on ajoute un prestataire, on allonge une conservation,
 * on oublie de rouvrir le document. Le texte devient alors une déclaration
 * fausse — ce qui est pire que pas de texte du tout, parce qu'il engage.
 *
 * Ici, la déclaration EST la configuration :
 *  - la page publique de confidentialité affiche ces entrées ;
 *  - la purge périodique applique ces durées ;
 *  - la liste des sous-traitants se déduit de l'environnement réellement
 *    configuré — un prestataire non branché n'apparaît pas.
 *
 * Conséquence voulue : brancher un nouveau prestataire sans l'inscrire ici se
 * remarque, et rallonger une conservation dans le texte sans la rallonger dans
 * la purge est impossible.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce fichier n'est pas
 * ---------------------------------------------------------------------------
 * Il ne remplace pas le registre écrit de l'article 30, ni l'avis d'un
 * juriste. Il donne les faits techniques exacts sur lesquels ce registre
 * s'appuie. Aucune valeur n'y est inventée : ce qui n'est pas connu du code
 * n'est pas affirmé.
 */

/** Bases légales de l'article 6.1 effectivement utilisées ici. */
export type LegalBasis =
  /** 6.1.b — exécution du contrat de vente. */
  | 'contract'
  /** 6.1.a — consentement, retirable à tout moment. */
  | 'consent'
  /** 6.1.c — obligation légale (comptabilité, facturation). */
  | 'legal-obligation'
  /** 6.1.f — intérêt légitime (sécurité du service). */
  | 'legitimate-interest'

export interface Processing {
  /** Identifiant stable, sert de clé de traduction. */
  key: string
  /** Tables concernées, pour relier la déclaration au schéma réel. */
  tables: readonly string[]
  basis: LegalBasis
  /** Durée de conservation en jours. `null` = tant que le compte existe. */
  retentionDays: number | null
  /**
   * Ce qui justifie la durée. Écrit en clair parce que c'est la question
   * qu'on se repose deux ans plus tard, jamais celle dont on se souvient.
   */
  retentionReason: string
}

/**
 * Durée de vie du cookie de session boutique, en jours.
 *
 * Les données rattachées à ce cookie ne doivent pas lui survivre : passé ce
 * délai, plus personne — pas même la personne concernée — ne peut les
 * retrouver. Les garder ne servirait qu'à les garder.
 *
 * Doit rester cohérent avec `MAX_AGE_SECONDS` de `lib/shop/session-token.ts`.
 * Un test vérifie l'égalité.
 */
export const GUEST_DATA_RETENTION_DAYS = 30

/**
 * Conservation des pièces comptables : 10 ans.
 *
 * Article L123-22 du code de commerce. C'est cette obligation qui prime sur
 * l'effacement (article 17.3.b du RGPD) : une facture ne s'efface pas à la
 * demande. Le reste du compte, si.
 */
export const ACCOUNTING_RETENTION_DAYS = 365 * 10

/**
 * Tunnels de commande abandonnés : 30 jours.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une durée séparée de celle des factures
 * ---------------------------------------------------------------------------
 * Une commande qui n'a JAMAIS été payée n'est pas une pièce comptable. Aucune
 * facture n'a été émise, aucun mouvement n'a eu lieu, aucun exercice ne la
 * porte. L'obligation de dix ans ne la couvre donc pas — et sans elle, il ne
 * reste aucune base pour garder un nom, une rue, un code postal, une ville, un
 * téléphone et une adresse e-mail.
 *
 * C'est pourtant ce qui se passait : la purge écartait la table `Order` en
 * bloc au motif que les factures s'y trouvent, et un tunnel abandonné y
 * restait indéfiniment. Les abandons sont plus nombreux que les ventes.
 *
 * Trente jours : la même durée que le cookie qui permet de retrouver le panier,
 * et de quoi laisser revenir quelqu'un qui a été interrompu au moment de payer.
 */
export const ABANDONED_ORDER_RETENTION_DAYS = 30

/**
 * Trace des événements de paiement : 30 jours.
 *
 * Elle sert à comprendre après coup pourquoi un encaissement a échoué. Passé
 * un mois, elle ne sert plus à rien : Stripe a cessé ses tentatives depuis
 * longtemps — sa fenêtre de reprise est de trois jours — et la commande porte
 * déjà tout ce qui compte.
 *
 * Effacer ces lignes ne rouvre PAS la porte au rejeu d'un ancien événement :
 * `constructEvent` vérifie l'horodatage inclus dans la signature et refuse
 * tout ce qui dépasse quelques minutes. L'unicité de `externalId` protège la
 * fenêtre courte, la signature protège le reste.
 */
export const WEBHOOK_EVENT_RETENTION_DAYS = 30

/**
 * Comptes inactifs : 3 ans sans connexion.
 *
 * Durée recommandée par la CNIL pour les données de prospects et de clients
 * inactifs. Au-delà, le compte est anonymisé — pas supprimé, pour ne pas
 * emporter les commandes qui relèvent de la conservation comptable.
 */
export const INACTIVE_ACCOUNT_RETENTION_DAYS = 365 * 3

export const PROCESSING_REGISTER: readonly Processing[] = [
  {
    key: 'account',
    tables: ['User', 'Session', 'Account'],
    basis: 'contract',
    retentionDays: INACTIVE_ACCOUNT_RETENTION_DAYS,
    retentionReason:
      'Tant que le compte vit, puis trois ans sans connexion (recommandation CNIL).',
  },
  {
    key: 'orders',
    tables: ['Order (payées)', 'OrderItem', 'Address'],
    basis: 'legal-obligation',
    retentionDays: ACCOUNTING_RETENTION_DAYS,
    retentionReason:
      'Pièce comptable : dix ans, article L123-22 du code de commerce.',
  },
  {
    // Déclaré à part, parce que la justification n'est PAS la même. Confondre
    // les deux revenait à couvrir un abandon par une obligation comptable qui
    // ne le concerne pas — et à annoncer dix ans là où rien ne les fonde.
    key: 'abandoned-orders',
    tables: ['Order (jamais payées)'],
    basis: 'contract',
    retentionDays: ABANDONED_ORDER_RETENTION_DAYS,
    retentionReason:
      'Aucun paiement, donc aucune pièce comptable : les coordonnées sont ' +
      'effacées au bout de trente jours, la trace anonyme de l’abandon reste.',
  },
  {
    // Déclaré, parce qu'un traitement non déclaré est un traitement qu'on
    // oublie de purger — c'est exactement ce qui est arrivé ici.
    key: 'payment-events',
    tables: ['WebhookEvent', 'Job'],
    basis: 'legitimate-interest',
    retentionDays: WEBHOOK_EVENT_RETENTION_DAYS,
    retentionReason:
      'Traces techniques des encaissements et des envois différés, ' +
      'caviardées de toute donnée personnelle et conservées un mois pour ' +
      'comprendre un échec.',
  },
  {
    key: 'favorites',
    tables: ['Favorite', 'GuestFavorite'],
    basis: 'legitimate-interest',
    retentionDays: GUEST_DATA_RETENTION_DAYS,
    retentionReason:
      'Sans compte, rattachés au cookie de session : ils ne lui survivent pas.',
  },
  {
    // Deux entrées, parce que les deux durées sont réellement différentes et
    // qu'une seule ligne en cachait une. Le panier d'un compte n'est PAS
    // effacé au bout de trente jours — on le retrouve à la connexion suivante,
    // c'est le comportement attendu — et le déclarer autrement était faux.
    key: 'cart',
    tables: ['Cart (avec compte)', 'CartItem'],
    basis: 'contract',
    retentionDays: null,
    retentionReason:
      'Retrouvé à chaque connexion, effacé avec le compte ou à sa demande.',
  },
  {
    key: 'cart-guest',
    tables: ['Cart (sans compte)', 'CartItem'],
    basis: 'contract',
    retentionDays: GUEST_DATA_RETENTION_DAYS,
    retentionReason:
      'Même durée que le cookie qui permet de le retrouver : au-delà, plus ' +
      'personne ne peut y accéder, pas même la personne concernée.',
  },
  {
    // Deux entrées, pour la même raison que le panier : les deux durées sont
    // réellement différentes.
    key: 'offers',
    tables: ['Offer (avec compte)'],
    basis: 'contract',
    retentionDays: null,
    retentionReason:
      'Mesure précontractuelle : conservée avec le compte, effacée avec lui ' +
      'ou à sa demande. Une offre qui a réellement abouti à une vente suit, ' +
      'elle, la durée comptable : elle justifie le prix porté sur une facture.',
  },
  {
    key: 'offers-guest',
    tables: ['Offer (sans compte)'],
    basis: 'contract',
    retentionDays: GUEST_DATA_RETENTION_DAYS,
    retentionReason:
      'Adresse e-mail et jeton de session : même durée que le cookie qui ' +
      'permet de retrouver la négociation. Au-delà, plus personne ne peut y ' +
      'accéder, pas même la personne concernée.',
  },
  {
    key: 'marketing',
    tables: ['User.marketingConsent'],
    basis: 'consent',
    retentionDays: null,
    retentionReason:
      'Jusqu’au retrait du consentement, dont la date est horodatée comme preuve.',
  },
  {
    key: 'security',
    tables: ['(compteurs externes)'],
    basis: 'legitimate-interest',
    retentionDays: 1,
    retentionReason:
      'Compteurs anti-force-brute : jetons non réversibles, renouvelés chaque jour.',
  },
] as const

/**
 * Localisation des traitements.
 *
 * Trois cas suffisent, et ils sont volontairement grossiers : la page publique
 * doit dire si les données sortent de l'Union et sous quelle garantie, pas
 * nommer un centre de données. `scc` = clauses contractuelles types.
 */
export type ProcessorRegion = 'eu' | 'us-scc' | 'eu-us-scc'

export interface Processor {
  key: string
  /** Nom commercial. Non traduit : c'est un nom propre. */
  name: string
  region: ProcessorRegion
}

/**
 * Sous-traitants effectivement actifs.
 *
 * Déduits de l'environnement : un prestataire dont la clé n'est pas
 * renseignée ne traite rien, et n'a donc pas à figurer dans une déclaration.
 * C'est ce qui empêche la liste de mentir dans les deux sens — annoncer un
 * tiers qu'on n'utilise pas, ou en oublier un qu'on utilise.
 *
 * L'hébergeur et la base ne sont pas déduits d'une clé : ils sont toujours là
 * dès qu'il y a un site. Ils sont donc inconditionnels.
 */
export function activeProcessors(): Processor[] {
  const processors: Processor[] = [
    { key: 'vercel', name: 'Vercel', region: 'eu' },
    { key: 'supabase', name: 'Supabase', region: 'eu' },
  ]

  if (process.env.RESEND_API_KEY) {
    processors.push({ key: 'resend', name: 'Resend', region: 'us-scc' })
  }

  if (process.env.STRIPE_SECRET_KEY) {
    processors.push({ key: 'stripe', name: 'Stripe', region: 'eu-us-scc' })
  }

  if (process.env.UPSTASH_REDIS_REST_URL) {
    processors.push({ key: 'upstash', name: 'Upstash', region: 'eu' })
  }

  if (process.env.CLOUDINARY_CLOUD_NAME) {
    processors.push({ key: 'cloudinary', name: 'Cloudinary', region: 'eu' })
  }

  if (process.env.SENTRY_DSN) {
    processors.push({ key: 'sentry', name: 'Sentry', region: 'eu' })
  }

  return processors
}
