import 'server-only'
import { createTranslator } from 'next-intl'

import { prisma } from '@/lib/db/client'
import { LEGAL, SITE } from '@/lib/config/site'
import { loadMessages } from '@/lib/i18n/messages'
import { formatDate, formatDateTime } from '@/lib/utils/format'
import { sendEmail, type EmailMessage } from './send'

/**
 * Les deux messages d'une rétractation en ligne.
 *
 * ---------------------------------------------------------------------------
 * L'accusé de réception est une pièce, pas un remerciement
 * ---------------------------------------------------------------------------
 * C'est lui que la directive appelle « support durable » : la personne doit
 * pouvoir le produire plus tard. Il reprend donc le CONTENU de la déclaration
 * — nom déclaré, commande, adresse — et sa date et son heure, celles du
 * serveur, à l'heure de Paris. Le reste (ce qu'il faut faire ensuite, quand
 * arrive le remboursement) vient après, et ne remplace rien.
 */

/** Délai légal, en jours, pour renvoyer les pièces et pour rembourser. */
const DELAI_JOURS = 14

export interface WithdrawalEmailData {
  orderNumber: string
  locale: string
  email: string
  declaredName: string
  /** L'instant de la PREMIÈRE déclaration : c'est lui qui fait courir les délais. */
  requestedAt: Date
  orderStatus: string
  lines: string[]
}

/**
 * Relit la déclaration au moment de partir.
 *
 * La file ne porte qu'un identifiant : le nom et l'adresse ne s'écrivent pas
 * dans `Job`. Une déclaration disparue — commande effacée entre-temps — ne
 * renvoie rien, et il n'y a rien à réessayer.
 */
export async function readWithdrawalEmailData(
  returnRequestId: string,
): Promise<WithdrawalEmailData | null> {
  const demande = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    select: {
      declaredName: true,
      requestedAt: true,
      order: {
        select: {
          orderNumber: true,
          locale: true,
          email: true,
          status: true,
          items: { select: { titleSnapshot: true } },
        },
      },
    },
  })

  if (!demande || !demande.order.email) return null

  return {
    orderNumber: demande.order.orderNumber,
    locale: demande.order.locale,
    email: demande.order.email,
    declaredName: demande.declaredName ?? '',
    requestedAt: demande.requestedAt,
    orderStatus: demande.order.status,
    lines: demande.order.items.map((item) => item.titleSnapshot),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function plusJours(date: Date, jours: number): Date {
  return new Date(date.getTime() + jours * 24 * 60 * 60_000)
}

/** Accusé de réception, à la personne, dans la langue de sa commande. */
export async function buildWithdrawalAcknowledgement(
  data: WithdrawalEmailData,
): Promise<EmailMessage> {
  const messages = await loadMessages(data.locale)
  const t = createTranslator({
    locale: data.locale,
    messages,
    namespace: 'withdrawal.email',
  })

  const recue = formatDateTime(data.requestedAt, data.locale)
  // Sans adresse de boutique renseignée, on ne devine pas où renvoyer : on
  // désigne la page qui la portera.
  const retour = LEGAL.address
    ? t('returnTo', { address: `${LEGAL.companyName}, ${LEGAL.address}` })
    : t('returnToLegalNotice')

  const contenu = [
    `${t('order')} : ${data.orderNumber}`,
    `${t('declaredBy')} : ${data.declaredName}`,
    `${t('address')} : ${data.email}`,
    `${t('receivedAt')} : ${recue}`,
  ]

  const blocs: { titre?: string; lignes: string[] }[] = [
    { lignes: [t('greeting')] },
    { lignes: [t('intro')] },
    { lignes: contenu },
    { titre: t('items'), lignes: data.lines.map((line) => `- ${line}`) },
    {
      titre: t('nextTitle'),
      lignes: [
        t('returnWithin', {
          days: DELAI_JOURS,
          date: formatDate(
            plusJours(data.requestedAt, DELAI_JOURS),
            data.locale,
          ),
        }),
        retour,
        t('returnCost'),
        t('refund', { days: DELAI_JOURS }),
      ],
    },
    { lignes: [t('keep')] },
    { lignes: [t('signature', { shop: SITE.name })] },
  ]

  const text = blocs
    .map((bloc) =>
      [...(bloc.titre ? [`${bloc.titre} :`] : []), ...bloc.lignes].join('\n'),
    )
    .join('\n\n')

  const html = blocs
    .map(
      (bloc) =>
        `<p>${[
          ...(bloc.titre ? [`<strong>${escapeHtml(bloc.titre)}</strong>`] : []),
          ...bloc.lignes.map(escapeHtml),
        ].join('<br>')}</p>`,
    )
    .join('')

  return {
    to: data.email,
    subject: t('subject', { orderNumber: data.orderNumber }),
    text,
    html,
    ...(LEGAL.email ? { replyTo: LEGAL.email } : {}),
  }
}

/**
 * Avis interne : une rétractation vient d'être déclarée.
 *
 * En français et sans mise en forme, comme l'avis « commande à préparer ». Il
 * dit surtout CE QUI COURT : l'échéance du remboursement, que la boutique ne
 * doit pas avoir à recalculer.
 */
export function buildShopWithdrawalNotice(
  data: WithdrawalEmailData,
): EmailMessage {
  const recue = formatDateTime(data.requestedAt, 'fr')
  const echeance = formatDate(plusJours(data.requestedAt, DELAI_JOURS), 'fr')
  const pasEncorePartie =
    data.orderStatus === 'PAID' || data.orderStatus === 'PREPARING'

  const text = [
    `Rétractation déclarée en ligne pour la commande ${data.orderNumber}.`,
    '',
    `Déclarée par : ${data.declaredName}`,
    `Adresse : ${data.email}`,
    `Reçue le : ${recue} (heure de Paris)`,
    '',
    'Pièces :',
    ...data.lines.map((line) => `- ${line}`),
    '',
    pasEncorePartie
      ? 'La commande n’est pas encore partie : ne l’expédiez pas sans avoir répondu.'
      : 'La commande est partie : attendez le retour des pièces.',
    `Remboursement dû au plus tard le ${echeance}, frais de livraison aller compris au tarif standard.`,
    'Il peut être différé jusqu’à la réception des pièces ou de la preuve de leur expédition, la première des deux.',
    '',
    'Un accusé de réception est parti à l’adresse ci-dessus.',
  ].join('\n')

  return {
    to: LEGAL.email,
    subject: `Rétractation — commande ${data.orderNumber}`,
    text,
    html: `<pre>${escapeHtml(text)}</pre>`,
    replyTo: data.email,
  }
}

export async function sendWithdrawalAcknowledgement(
  data: WithdrawalEmailData,
): Promise<void> {
  await sendEmail(await buildWithdrawalAcknowledgement(data))
}

export async function sendShopWithdrawalNotice(
  data: WithdrawalEmailData,
): Promise<void> {
  if (!LEGAL.email) {
    // Sans adresse de boutique renseignée, on ne devine pas un destinataire.
    // Le travail échoue, et la file le signale : une rétractation qu'aucune
    // boutique ne lit est un remboursement en retard.
    throw new Error(
      'LEGAL_EMAIL est absente : impossible de prévenir la boutique.',
    )
  }
  await sendEmail(buildShopWithdrawalNotice(data))
}
