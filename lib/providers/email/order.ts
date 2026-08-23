import 'server-only'

import { createTranslator } from 'next-intl'
import { SITE, LEGAL } from '@/lib/config/site'
import { loadMessages } from '@/lib/i18n/messages'
import { formatPrice } from '@/lib/utils/format'
import { sendEmail, type EmailMessage } from './send'

/**
 * E-mails de commande.
 *
 * ---------------------------------------------------------------------------
 * Aucune donnée n'est recalculée ici
 * ---------------------------------------------------------------------------
 * Tout vient des instantanés de la commande. Un e-mail de confirmation qui
 * relirait le catalogue afficherait le prix du jour, pas celui payé — et le
 * jour où une pièce baisse, la personne reçoit une confirmation qui contredit
 * son relevé bancaire.
 *
 * ---------------------------------------------------------------------------
 * Deux versions, toujours
 * ---------------------------------------------------------------------------
 * Texte et HTML. Certains clients de messagerie n'affichent que la première,
 * et une confirmation de commande illisible est une confirmation qui n'existe
 * pas. Le HTML reste volontairement rudimentaire : les gabarits soignés sont
 * un travail de phase 6, une commande payée aujourd'hui a besoin d'être
 * confirmée aujourd'hui.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi `createTranslator` et non `getTranslations`
 * ---------------------------------------------------------------------------
 * `getTranslations` lit la configuration attachée à la REQUÊTE en cours. Un
 * e-mail de confirmation est composé par la file de travaux, qui tourne sans
 * requête : il n'y a pas de langue « courante » à en déduire, et l'appel
 * échoue.
 *
 * La langue vient donc de la commande — celle dans laquelle la personne a
 * acheté — et les messages sont chargés explicitement. C'est aussi ce qui rend
 * ces gabarits testables sans monter un serveur.
 */

// Le chargement des catalogues vit dans `lib/i18n/messages.ts` : l'import
// d'inventaire en a besoin lui aussi, et deux caches séparés finiraient par se
// contredire sur ce qu'est une locale inconnue.

async function translatorFor(locale: string) {
  const messages = await loadMessages(locale)
  return createTranslator({ locale, messages, namespace: 'orderEmail' })
}

export interface OrderEmailLine {
  title: string
  reference: string | null
  unitPriceCents: number
}

export interface OrderEmailData {
  orderNumber: string
  locale: string
  email: string
  lines: readonly OrderEmailLine[]
  subtotalCents: number
  discountCents: number
  shippingCents: number
  totalCents: number
  /** Adresse de livraison, telle que figée sur la commande. */
  shipping: {
    firstName?: string
    lastName?: string
    line1?: string
    line2?: string
    postalCode?: string
    city?: string
    country?: string
  }
  invoiceNumber: string | null
}

/** Échappe ce qui part dans du HTML. Un titre d'article vient de la base. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function addressLines(shipping: OrderEmailData['shipping']): string[] {
  const name = [shipping.firstName, shipping.lastName].filter(Boolean).join(' ')
  const city = [shipping.postalCode, shipping.city].filter(Boolean).join(' ')

  // Aucune ligne vide, aucun tiret pour combler un trou : on affiche ce qui
  // existe.
  return [name, shipping.line1, shipping.line2, city, shipping.country].filter(
    (line): line is string => Boolean(line && line.trim()),
  )
}

/** Confirmation adressée à l'acheteuse, dans SA langue. */
export async function buildOrderConfirmation(
  data: OrderEmailData,
): Promise<EmailMessage> {
  const t = await translatorFor(data.locale)
  const price = (cents: number) => formatPrice(cents, data.locale)

  const lines = data.lines.map((line) => {
    const reference = line.reference ? ` (${line.reference})` : ''
    return `- ${line.title}${reference} — ${price(line.unitPriceCents)}`
  })

  const totals = [
    `${t('subtotal')} : ${price(data.subtotalCents)}`,
    ...(data.discountCents > 0
      ? [`${t('discount')} : −${price(data.discountCents)}`]
      : []),
    `${t('shipping')} : ${
      data.shippingCents === 0 ? t('freeShipping') : price(data.shippingCents)
    }`,
    `${t('total')} : ${price(data.totalCents)}`,
  ]

  const address = addressLines(data.shipping)

  const text = [
    t('greeting'),
    '',
    t('intro', { orderNumber: data.orderNumber }),
    '',
    ...lines,
    '',
    ...totals,
    '',
    `${t('deliveryTo')} :`,
    ...address,
    '',
    ...(data.invoiceNumber
      ? [t('invoice', { number: data.invoiceNumber }), '']
      : []),
    t('withdrawal'),
    '',
    t('signature', { shop: SITE.name }),
  ].join('\n')

  const html = [
    `<p>${escapeHtml(t('greeting'))}</p>`,
    `<p>${escapeHtml(t('intro', { orderNumber: data.orderNumber }))}</p>`,
    '<ul>',
    ...data.lines.map((line) => {
      const reference = line.reference ? ` (${escapeHtml(line.reference)})` : ''
      return `<li>${escapeHtml(line.title)}${reference} — ${escapeHtml(
        price(line.unitPriceCents),
      )}</li>`
    }),
    '</ul>',
    `<p>${totals.map(escapeHtml).join('<br>')}</p>`,
    `<p>${escapeHtml(t('deliveryTo'))} :<br>${address
      .map(escapeHtml)
      .join('<br>')}</p>`,
    ...(data.invoiceNumber
      ? [`<p>${escapeHtml(t('invoice', { number: data.invoiceNumber }))}</p>`]
      : []),
    `<p>${escapeHtml(t('withdrawal'))}</p>`,
    `<p>${escapeHtml(t('signature', { shop: SITE.name }))}</p>`,
  ].join('')

  return {
    to: data.email,
    subject: t('subject', { orderNumber: data.orderNumber }),
    text,
    html,
    // La réponse arrive à la boutique, pas dans le vide de l'adresse d'envoi.
    ...(LEGAL.email ? { replyTo: LEGAL.email } : {}),
  }
}

/**
 * Avis interne : une commande est à préparer.
 *
 * Volontairement en français et sans mise en forme — c'est un message de
 * service, lu par une seule personne, qui doit contenir ce qu'il faut pour
 * aller chercher les pièces sur l'étagère.
 */
export function buildShopNotification(data: OrderEmailData): EmailMessage {
  const price = (cents: number) => formatPrice(cents, 'fr')

  const lines = data.lines.map((line) => {
    const reference = line.reference ? ` [${line.reference}]` : ''
    return `- ${line.title}${reference} — ${price(line.unitPriceCents)}`
  })

  const text = [
    `Commande ${data.orderNumber} payée.`,
    '',
    'À préparer :',
    ...lines,
    '',
    `Total encaissé : ${price(data.totalCents)}`,
    `Port facturé : ${price(data.shippingCents)}`,
    '',
    'Livraison :',
    ...addressLines(data.shipping),
    '',
    `Contact : ${data.email}`,
  ].join('\n')

  return {
    to: LEGAL.email,
    subject: `Commande ${data.orderNumber} à préparer`,
    text,
    html: `<pre>${escapeHtml(text)}</pre>`,
    // Répondre à l'avis répond à l'acheteuse : c'est ce qu'on veut faire neuf
    // fois sur dix.
    replyTo: data.email,
  }
}

export async function sendOrderConfirmation(data: OrderEmailData): Promise<void> {
  await sendEmail(await buildOrderConfirmation(data))
}

export async function sendShopNotification(data: OrderEmailData): Promise<void> {
  if (!LEGAL.email) {
    // Sans adresse de boutique renseignée, on ne devine pas un destinataire.
    throw new Error(
      'LEGAL_EMAIL est absente : impossible de prévenir la boutique.',
    )
  }
  await sendEmail(buildShopNotification(data))
}
