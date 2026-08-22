import 'server-only'

import type { Prisma } from '@prisma/client'
import { LEGAL, SITE, hasLegalIdentity } from '@/lib/config/site'

/**
 * Facturation.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la numérotation ne peut pas avoir de trous
 * ---------------------------------------------------------------------------
 * L'article 242 nonies A de l'annexe II du CGI impose « un numéro unique basé
 * sur une séquence chronologique continue, sans rupture ». Ce n'est pas une
 * préférence d'écriture : en contrôle, un trou dans la numérotation se présume
 * comme une facture détruite, et c'est au commerçant d'apporter la preuve
 * contraire.
 *
 * Une séquence PostgreSQL est donc exclue. `nextval` ne revient jamais en
 * arrière — pas même quand la transaction qui l'a appelée échoue — et laisse
 * des trous par conception. C'est parfait pour un numéro de commande, qui
 * n'est pas une pièce comptable ; c'est disqualifiant ici.
 *
 * Le compteur est donc une LIGNE, incrémentée dans la transaction qui écrit le
 * numéro sur la commande. Si cette transaction échoue, l'incrément échoue avec
 * elle et le numéro reste disponible. Deux commandes simultanées se
 * sérialisent sur le verrou de ligne posé par l'UPDATE : la seconde attend la
 * première, personne ne saute de numéro.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une seule suite, sans remise à zéro annuelle
 * ---------------------------------------------------------------------------
 * Les deux existent en pratique — suite unique, ou une série par année. La
 * suite unique a un avantage décisif : sa continuité se démontre en comptant.
 * Une série annuelle demande d'expliquer pourquoi le numéro repart à 1, ce qui
 * est admis mais se justifie. On prend le format qui ne se justifie pas.
 *
 * L'année figure sur la facture, à sa place : la date d'émission.
 */

/** Clé du compteur. Une seule suite, pour toute la vie de la boutique. */
const INVOICE_COUNTER_KEY = 'invoice'

/** Largeur du numéro. Six chiffres couvrent un million de factures. */
const INVOICE_DIGITS = 6

export class LegalIdentityMissingError extends Error {
  constructor() {
    super(
      'Identité légale incomplète : une facture ne peut pas être émise sans ' +
        'dénomination, SIRET et adresse.',
    )
    this.name = 'LegalIdentityMissingError'
  }
}

/**
 * Attribue le prochain numéro de facture.
 *
 * À appeler DANS la transaction qui l'écrit sur la commande, jamais avant :
 * c'est ce qui rend la suite sans trou.
 *
 * `INSERT … ON CONFLICT DO UPDATE` crée la ligne au premier appel et
 * l'incrémente ensuite, en une seule instruction atomique. Un `SELECT` suivi
 * d'un `UPDATE` laisserait deux transactions lire la même valeur.
 */
export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const [row] = await tx.$queryRaw<[{ value: number }]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt")
    VALUES (${INVOICE_COUNTER_KEY}, 1, now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = "Counter"."value" + 1,
          "updatedAt" = now()
    RETURNING "value"
  `

  if (!row) {
    throw new Error('Compteur de facturation : aucune valeur renvoyée.')
  }

  return formatInvoiceNumber(row.value)
}

export function formatInvoiceNumber(value: number): string {
  return `FA-${String(value).padStart(INVOICE_DIGITS, '0')}`
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

/** Une adresse telle qu'elle a été figée sur la commande. */
export interface InvoiceAddress {
  firstName?: string
  lastName?: string
  line1?: string
  line2?: string
  postalCode?: string
  city?: string
  country?: string
}

export interface InvoiceLine {
  label: string
  /** Référence d'inventaire, pour rapprocher la ligne de la pièce. */
  reference: string | null
  unitPriceCents: number
}

/**
 * Facture, telle qu'elle doit être présentée.
 *
 * Assemblée à partir des INSTANTANÉS de la commande, jamais du catalogue
 * courant : le prix d'une pièce baisse avec le temps, et une facture émise il
 * y a six mois ne doit pas changer parce que le catalogue a bougé.
 */
export interface Invoice {
  number: string
  issuedAt: Date
  orderNumber: string

  seller: {
    name: string
    address: string
    siret: string
    email: string
    /** Mention obligatoire en franchise en base de TVA. */
    vatNotice: string | null
  }

  customer: {
    email: string
    billing: InvoiceAddress
    shipping: InvoiceAddress
  }

  lines: InvoiceLine[]
  subtotalCents: number
  discountCents: number
  shippingCents: number
  totalCents: number
  currency: string

  paidAt: Date | null
}

/** La commande, vue par la facturation. */
export interface InvoiceSource {
  orderNumber: string
  invoiceNumber: string | null
  email: string
  billingAddress: unknown
  shippingAddress: unknown
  subtotalCents: number
  discountCents: number
  shippingCents: number
  totalCents: number
  paidAt: Date | null
  createdAt: Date
  items: readonly {
    titleSnapshot: string
    unitPriceCents: number
    article: { sku: string } | null
  }[]
}

/**
 * Lit une adresse figée en JSON sans jamais inventer de champ manquant.
 *
 * La colonne est un `Json` : rien ne garantit sa forme des années plus tard,
 * si le tunnel change. Une facture doit afficher ce qui s'y trouve, ou rien.
 */
function readAddress(value: unknown): InvoiceAddress {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>

  const text = (key: string): string | undefined =>
    typeof record[key] === 'string' && record[key] !== ''
      ? (record[key] as string)
      : undefined

  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    line1: text('line1'),
    line2: text('line2'),
    postalCode: text('postalCode'),
    city: text('city'),
    country: text('country'),
  }
}

/**
 * Compose la facture d'une commande.
 *
 * Lève si l'identité légale manque : une facture sans dénomination ni SIRET
 * n'est pas une facture incomplète, c'est un document sans valeur. Mieux vaut
 * refuser de l'émettre que d'en publier une qui ne vaut rien.
 */
export function buildInvoice(order: InvoiceSource): Invoice {
  if (!hasLegalIdentity()) throw new LegalIdentityMissingError()

  if (!order.invoiceNumber) {
    throw new Error(
      `Commande ${order.orderNumber} : aucun numéro de facture attribué.`,
    )
  }

  return {
    number: order.invoiceNumber,
    // La date d'émission est celle du paiement, pas celle de l'impression :
    // c'est elle qui rattache la facture à un exercice comptable.
    issuedAt: order.paidAt ?? order.createdAt,
    orderNumber: order.orderNumber,

    seller: {
      name: LEGAL.companyName,
      address: LEGAL.address,
      siret: LEGAL.siret,
      email: LEGAL.email,
      vatNotice: LEGAL.vatExempt ? LEGAL.vatExemptionNotice : null,
    },

    customer: {
      email: order.email,
      billing: readAddress(order.billingAddress),
      shipping: readAddress(order.shippingAddress),
    },

    lines: order.items.map((item) => ({
      label: item.titleSnapshot,
      reference: item.article?.sku ?? null,
      unitPriceCents: item.unitPriceCents,
    })),

    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: SITE.currency,

    paidAt: order.paidAt,
  }
}
