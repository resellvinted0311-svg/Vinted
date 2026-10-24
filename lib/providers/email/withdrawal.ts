import 'server-only'
import { createTranslator } from 'next-intl'

import { prisma } from '@/lib/db/client'
import { LEGAL, SITE } from '@/lib/config/site'
import { loadMessages } from '@/lib/i18n/messages'
import { formatDate, formatDateTime } from '@/lib/utils/format'
import { apresJours, apresJoursOuvrable } from '@/lib/domain/delais'
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

/**
 * Les statuts où la commande n'est pas encore partie.
 *
 * Ils changent tout le message. Une acheteuse qui se rétracte avant
 * l'expédition n'a rien à renvoyer, et le remboursement ne peut pas être
 * différé « jusqu'à la récupération des biens » — la boutique les a encore.
 * La première version lui demandait pourtant de renvoyer des pièces jamais
 * reçues, et annonçait à la boutique un report qui n'existe pas : en le
 * suivant, elle aurait attendu un retour qui ne viendrait jamais, et
 * remboursé en retard.
 */
const PAS_ENCORE_PARTIE = new Set(['PAID', 'PREPARING'])

export interface WithdrawalEmailData {
  orderNumber: string
  locale: string
  /** L'adresse DE LA COMMANDE : c'est là, et seulement là, que part l'accusé. */
  email: string
  declaredName: string
  /** L'adresse saisie dans la déclaration. Peut différer de la précédente. */
  declaredEmail: string
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
      declaredEmail: true,
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
    declaredEmail: demande.declaredEmail ?? demande.order.email,
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
  const remboursementAuPlusTard = formatDate(
    apresJours(data.requestedAt, DELAI_JOURS),
    data.locale,
  )

  const contenu = [
    `${t('order')} : ${data.orderNumber}`,
    `${t('declaredBy')} : ${data.declaredName}`,
    `${t('address')} : ${data.declaredEmail}`,
    `${t('receivedAt')} : ${recue}`,
  ]

  const ensuite = PAS_ENCORE_PARTIE.has(data.orderStatus)
    ? [
        t('notShipped'),
        t('refundNotShipped', { date: remboursementAuPlusTard }),
      ]
    : [
        t('returnWithin', {
          // Reporté au premier jour ouvrable : ce report profite à qui doit
          // agir avant l'échéance. Voir `lib/domain/delais.ts`.
          date: formatDate(
            apresJoursOuvrable(data.requestedAt, DELAI_JOURS),
            data.locale,
          ),
        }),
        // Sans adresse de boutique renseignée, on ne devine pas où renvoyer :
        // on désigne la page qui la portera.
        LEGAL.address
          ? t('returnTo', { address: `${LEGAL.companyName}, ${LEGAL.address}` })
          : t('returnToLegalNotice'),
        t('returnCost'),
        t('refund', { date: remboursementAuPlusTard }),
      ]

  const blocs: { titre?: string; lignes: string[] }[] = [
    { lignes: [t('greeting')] },
    { lignes: [t('intro')] },
    { lignes: contenu },
    { titre: t('items'), lignes: data.lines.map((line) => `- ${line}`) },
    { titre: t('nextTitle'), lignes: ensuite },
    // Toujours, et pas seulement quand l'adresse diffère : connaître un
    // numéro et une adresse ne prouve pas qu'on est l'acheteuse. Celle qui
    // reçoit cet accusé sans avoir rien demandé doit savoir quoi faire.
    { lignes: [t('notYou'), t('keep')] },
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
 * doit pas avoir à recalculer. Elle est donnée sans report de week-end : on
 * s'engage sur la date la plus tôt.
 */
export function buildShopWithdrawalNotice(
  data: WithdrawalEmailData,
): EmailMessage {
  const recue = formatDateTime(data.requestedAt, 'fr')
  const echeance = formatDate(apresJours(data.requestedAt, DELAI_JOURS), 'fr')
  const pasEncorePartie = PAS_ENCORE_PARTIE.has(data.orderStatus)
  const adresseDifferente = data.declaredEmail !== data.email

  const text = [
    `Rétractation déclarée en ligne pour la commande ${data.orderNumber}.`,
    '',
    `Déclarée par : ${data.declaredName}`,
    `Adresse indiquée : ${data.declaredEmail}`,
    `Reçue le : ${recue}`,
    '',
    ...(adresseDifferente
      ? [
          `ATTENTION : l’adresse indiquée n’est pas celle de la commande (${data.email}).`,
          'Un tiers ne peut pas se rétracter à la place de la personne qui a commandé :',
          'faites confirmer à l’adresse de la commande avant d’annuler ou de rembourser.',
          'L’accusé de réception est parti à l’adresse de la commande, pas à celle indiquée.',
          '',
        ]
      : []),
    'Pièces :',
    ...data.lines.map((line) => `- ${line}`),
    '',
    ...(pasEncorePartie
      ? [
          'La commande n’est pas encore partie : ne l’expédiez pas.',
          `Remboursement intégral, port compris, au plus tard le ${echeance}.`,
        ]
      : [
          'La commande est partie : attendez le retour des pièces.',
          `Remboursement dû au plus tard le ${echeance}, frais de livraison aller compris au tarif standard.`,
          'Il peut être différé jusqu’à la réception des pièces ou de la preuve de leur expédition, la première des deux.',
        ]),
    '',
    'Aucune date n’est contrôlée à l’enregistrement : vérifiez que la rétractation',
    'tombe dans les quatorze jours suivant la réception.',
  ].join('\n')

  return {
    to: LEGAL.email,
    subject: `Rétractation — commande ${data.orderNumber}`,
    text,
    html: `<pre>${escapeHtml(text)}</pre>`,
    // Répondre à l'avis répond à l'adresse DE LA COMMANDE : c'est celle qu'on
    // sait appartenir à l'acheteuse, et celle à qui faire confirmer.
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
