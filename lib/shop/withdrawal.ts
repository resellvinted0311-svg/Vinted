import 'server-only'

import type { OrderStatus } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { enqueue } from '@/lib/jobs/queue'
import { logger } from '@/lib/observability/logger'
import type { WithdrawalInput } from '@/lib/validation/withdrawal'

/**
 * La rétractation en ligne — « Renoncer au contrat ici ».
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle existe
 * ---------------------------------------------------------------------------
 * Depuis le 19 juin 2026, tout professionnel qui vend en ligne doit offrir une
 * FONCTION de rétractation : une mention claire (« renoncer au contrat ici »),
 * un formulaire, un bouton « confirmer la rétractation », et un accusé de
 * réception sur support durable reprenant le contenu de la déclaration, sa
 * date et son heure (directive 2023/2673, art. 11 bis de la directive
 * 2011/83 ; L221-21 et D221-5 du code de la consommation selon F23455). Le
 * formulaire papier à recopier ne suffit plus.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module ne dit JAMAIS : si la commande existe
 * ---------------------------------------------------------------------------
 * Le registre des commandes refuse délibérément tout champ « numéro + e-mail »
 * (voir `app/[locale]/(shop)/commande/suivi/page.tsx`) : le numéro est court
 * et séquentiel, l'adresse se devine, et le formulaire devient une machine à
 * essayer des couples. Cette fonction est OBLIGÉE de demander ce couple — c'est
 * le moyen d'identifier le contrat sans imposer de compte.
 *
 * Elle le fait donc sans rien rendre : correspondance ou non, l'appelant reçoit
 * la même réponse, et seul le titulaire réel de l'adresse de la commande
 * reçoit un message. Une faute de frappe se rattrape par l'accusé qui n'arrive
 * pas — la page le dit — plutôt que par un oracle.
 *
 * Une déclaration qui ne correspond à rien n'est pas conservée : ce serait
 * stocker les nom et adresse de n'importe qui, sur la seule foi d'un
 * formulaire public.
 */

/** La valeur de `ReturnRequest.reason` qui désigne une rétractation. */
export const WITHDRAWAL_REASON = 'withdrawal'

/**
 * Les commandes dont on peut se rétracter : celles où un contrat existe.
 *
 * Une commande jamais payée n'est pas une vente — il n'y a rien à rétracter.
 * Une commande annulée ou entièrement remboursée est déjà dénouée.
 *
 * AUCUN contrôle de date n'est fait ici, et c'est voulu. Le délai court à
 * partir de la RÉCEPTION, que la boutique ne connaît pas toujours : un envoi
 * sans suivi n'a pas de date de livraison. Refuser sur une date devinée
 * priverait quelqu'un d'un droit qu'il a peut-être encore ; enregistrer et
 * laisser la boutique apprécier ne prive personne de rien.
 */
export const WITHDRAWABLE_STATUSES: readonly OrderStatus[] = [
  'PAID',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'PARTIALLY_REFUNDED',
]

export interface WithdrawalOutcome {
  /**
   * Les travaux d'e-mail inscrits, à pousser après la réponse. Vide quand rien
   * ne correspond — et l'appelant ne doit RIEN en déduire à voix haute.
   */
  jobIds: string[]
}

/**
 * Enregistre une déclaration de rétractation, ou ne fait rien.
 *
 * Trois issues, indiscernables pour l'appelant :
 *  - le couple correspond à une commande rétractable : la déclaration est
 *    enregistrée, l'accusé de réception et l'avis à la boutique sont inscrits ;
 *  - une déclaration existe déjà pour cette commande : rien n'est réécrit, et
 *    l'accusé repart, avec la date de la PREMIÈRE déclaration — c'est elle qui
 *    a fait courir les délais. La personne qui le cherche dans ses indésirables
 *    le retrouve ; la boutique n'est pas prévenue deux fois ;
 *  - rien ne correspond : rien n'est écrit.
 */
export async function recordWithdrawal(
  input: WithdrawalInput,
): Promise<WithdrawalOutcome> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber: input.orderNumber },
      select: {
        id: true,
        email: true,
        status: true,
        items: { select: { id: true } },
      },
    })

    // L'adresse est comparée telle que le tunnel l'a enregistrée : en
    // minuscules, comme `emailSchema` la rend des deux côtés.
    if (
      !order ||
      order.email !== input.email ||
      !WITHDRAWABLE_STATUSES.includes(order.status)
    ) {
      return { jobIds: [] }
    }

    const existante = await tx.returnRequest.findFirst({
      where: { orderId: order.id, reason: WITHDRAWAL_REASON },
      orderBy: { requestedAt: 'asc' },
      select: { id: true },
    })

    if (existante) {
      const ack = await enqueue(tx, {
        type: 'withdrawal.acknowledge',
        payload: { returnRequestId: existante.id },
      })
      return { jobIds: [ack] }
    }

    const demande = await tx.returnRequest.create({
      data: {
        orderId: order.id,
        orderItemIds: order.items.map((item) => item.id),
        reason: WITHDRAWAL_REASON,
        declaredName: input.name,
      },
      select: { id: true },
    })

    // Ni le nom ni l'adresse ne voyagent dans la file : `Job.payload` est
    // déclarée au registre comme ne portant que des identifiants internes.
    // Le contenu se relit à l'exécution.
    const ack = await enqueue(tx, {
      type: 'withdrawal.acknowledge',
      payload: { returnRequestId: demande.id },
    })
    const avis = await enqueue(tx, {
      type: 'withdrawal.notify-shop',
      payload: { returnRequestId: demande.id },
    })

    logger.info('withdrawal.recorded', { returnRequestId: demande.id })

    return { jobIds: [ack, avis] }
  })
}
