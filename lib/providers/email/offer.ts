import 'server-only'

import { createTranslator } from 'next-intl'

import { SITE, LEGAL } from '@/lib/config/site'
import { loadMessages } from '@/lib/i18n/messages'
import { formatDate, formatPrice } from '@/lib/utils/format'
import { sendEmail, type EmailMessage } from './send'

/**
 * E-mails de négociation.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi l'accusé de réception n'est pas facultatif
 * ---------------------------------------------------------------------------
 * Une proposition sans accusé laisse son auteur dans le doute : a-t-elle été
 * reçue ? Le formulaire l'a bien dit à l'écran, mais l'écran se ferme. Sans
 * e-mail, une personne sans compte n'a plus AUCUNE trace de ce qu'elle a
 * proposé, ni de la date à laquelle une réponse est due.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la boutique est prévenue séparément
 * ---------------------------------------------------------------------------
 * Une offre qui n'est pas lue expire. Le vendeur a quarante-huit heures pour
 * répondre, et rien dans l'interface publique ne l'en avertit : sans cet avis,
 * toutes les offres finiraient par s'éteindre d'elles-mêmes et la négociation
 * ne serait qu'un formulaire décoratif.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

async function translatorFor(locale: string) {
  const messages = await loadMessages(locale)
  return createTranslator({ locale, messages, namespace: 'offerEmail' })
}

export interface OfferEmailData {
  locale: string
  /** Adresse de réponse : celle du compte, ou celle donnée sans compte. */
  email: string
  /** Numéro d'inventaire — la référence que les deux côtés partagent. */
  reference: string
  title: string
  amountCents: number
  /** `pending`, `accepted` ou `rejected`. */
  outcome: 'pending' | 'accepted' | 'rejected'
  /** Échéance de réponse, sur une offre en attente. */
  expiresAt: Date | null
  /** Validité du prix, sur une offre acceptée. */
  priceValidUntil: Date | null
  /** Adresse publique de la pièce, pour y revenir. */
  url: string
}

/** Accusé destiné à la personne qui a proposé. */
export async function buildOfferAcknowledgement(
  data: OfferEmailData,
): Promise<EmailMessage> {
  const t = await translatorFor(data.locale)
  const amount = formatPrice(data.amountCents, data.locale)

  const body =
    data.outcome === 'accepted'
      ? t('accepted', {
          amount,
          date: data.priceValidUntil
            ? formatDate(data.priceValidUntil, data.locale)
            : '',
        })
      : data.outcome === 'rejected'
        ? t('rejected', { amount })
        : t('pending', {
            amount,
            date: data.expiresAt
              ? formatDate(data.expiresAt, data.locale)
              : '',
          })

  const lines = [
    t('greeting'),
    '',
    `${data.title} — ${data.reference}`,
    '',
    body,
    '',
    // Répété dans chaque cas, y compris l'acceptation : c'est au moment où
    // l'on croit la pièce acquise que l'information compte le plus.
    t('noHold'),
    '',
    data.url,
    '',
    t('signature', { shop: SITE.name }),
  ]

  return {
    to: data.email,
    subject: t(`subject.${data.outcome}`, { reference: data.reference }),
    text: lines.join('\n'),
    html: lines
      .map((line) => (line === '' ? '' : `<p>${escapeHtml(line)}</p>`))
      .join(''),
    // Répondre à l'accusé écrit à la boutique, pas à l'adresse d'envoi.
    ...(LEGAL.email ? { replyTo: LEGAL.email } : {}),
  }
}

/**
 * Avis interne : une offre attend une réponse.
 *
 * Volontairement en français et sans mise en forme — c'est un message de
 * service, lu par une seule personne, qui doit contenir de quoi décider.
 */
export function buildOfferShopNotice(data: OfferEmailData): EmailMessage {
  const text = [
    `Offre de ${formatPrice(data.amountCents, 'fr')} sur ${data.reference}.`,
    '',
    data.title,
    data.url,
    '',
    data.expiresAt
      ? `Sans réponse, elle expire le ${formatDate(data.expiresAt, 'fr')}.`
      : '',
    '',
    `Contact : ${data.email}`,
  ].join('\n')

  return {
    to: LEGAL.email,
    subject: `Offre à traiter : ${data.reference}`,
    text,
    html: `<pre>${escapeHtml(text)}</pre>`,
    // Répondre à l'avis écrit directement à la personne qui a proposé.
    replyTo: data.email,
  }
}

export async function sendOfferAcknowledgement(
  data: OfferEmailData,
): Promise<void> {
  await sendEmail(await buildOfferAcknowledgement(data))
}

export async function sendOfferShopNotice(data: OfferEmailData): Promise<void> {
  if (!LEGAL.email) {
    // Sans adresse de boutique renseignée, on ne devine pas un destinataire.
    throw new Error(
      'LEGAL_EMAIL est absente : impossible de signaler l’offre à la boutique.',
    )
  }
  await sendEmail(buildOfferShopNotice(data))
}
