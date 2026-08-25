import { z } from 'zod'

import { articleIdSchema } from './shop'

/**
 * Validation des entrées de l'administration.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un schéma à part, et non `respondOfferSchema`
 * ---------------------------------------------------------------------------
 * `lib/validation/offers.ts` en porte un, écrit en avance de phase et jamais
 * appelé. Il ne suffit pas ici, pour trois raisons :
 *
 *  - il accepte `counterAmountCents` sur une acceptation comme sur un refus.
 *    `z.object` garde la clé, `respondToOffer` l'ignore, et une combinaison
 *    incohérente passe sans que rien ne le dise. Une union discriminée dit la
 *    vraie forme : chaque action a exactement les champs qui la concernent ;
 *
 *  - il ne porte aucune CONFIRMATION de franchissement du plancher. Le domaine
 *    autorise la vente à perte — c'est une décision commerciale, elle appartient
 *    au vendeur — mais exige qu'elle soit prise « en connaissance de cause » et
 *    qu'elle laisse une trace (`Offer.acceptedBelowFloor`). Sans un geste
 *    explicite à ce moment-là, cette colonne serait la trace de rien ;
 *
 *  - il ne couvre pas la contre-proposition telle que ce lot la traite, c'est-
 *    à-dire pas du tout (voir l'en-tête de `lib/admin/offer-actions.ts`).
 *
 * Le schéma ne porte AUCUN prix de référence, aucun plancher, aucun montant
 * d'offre : `respondToOffer` les relit tous en base, dans la transaction. Un
 * montant de référence qui traverse le navigateur est un montant qu'on réécrit.
 */

/**
 * Réponse du vendeur à une offre reçue.
 *
 * `confirmBelowFloor` n'est PAS une permission accordée par le client : c'est
 * une déclaration d'intention. Le serveur relit le plancher, constate lui-même
 * si l'offre passe dessous, et n'exige la déclaration que dans ce cas. Un
 * appelant qui la poserait toujours à `true` ne gagnerait rien — il se
 * priverait seulement du garde-fou qu'elle lui offre.
 */
export const respondToOfferSchema = z.discriminatedUnion('action', [
  z.object({
    offerId: articleIdSchema,
    action: z.literal('accept'),
    /** Coché quand le vendeur assume de descendre sous le prix plancher. */
    confirmBelowFloor: z.literal('on').optional(),
  }),
  z.object({
    offerId: articleIdSchema,
    action: z.literal('reject'),
  }),
])

export type RespondToOfferInput = z.infer<typeof respondToOfferSchema>
