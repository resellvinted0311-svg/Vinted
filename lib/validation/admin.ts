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

/**
 * Longueur maximale d'un numéro de suivi.
 *
 * Les formats réels vont de treize caractères (S10 de l'UPU) à une trentaine
 * chez certains transporteurs. Quarante laisse la marge sans laisser passer un
 * champ libre : ce numéro est recopié dans un e-mail, et il n'y a aucune raison
 * qu'un paragraphe s'y glisse.
 */
const MAX_TRACKING_LENGTH = 40

/**
 * Un lien de suivi, et seulement un lien de suivi.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le protocole est contrôlé, et pas seulement la forme
 * ---------------------------------------------------------------------------
 * Cette adresse est recopiée dans un `href` sur la page de suivi de
 * l'acheteuse. `z.string().url()` accepte `javascript:alert(1)` — c'est une URL
 * parfaitement valide. Elle accepte aussi `data:text/html,…`, qui ouvre une
 * page arbitraire portant l'origine du site.
 *
 * On n'attend d'un attaquant externe ici : le champ n'est rempli que par un
 * administrateur. Le défaut réel qu'on écarte est plus bête et plus probable —
 * un copier-coller malheureux, une adresse recopiée depuis un gestionnaire de
 * mots de passe — et le contrôle coûte quatre lignes.
 */
const trackingUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' || url.protocol === 'http:'
      } catch {
        return false
      }
    },
    { message: 'Lien de suivi invalide' },
  )

/**
 * Faire avancer une commande sur son parcours d'expédition.
 *
 * ---------------------------------------------------------------------------
 * L'état visé n'est PAS dans le formulaire
 * ---------------------------------------------------------------------------
 * Le client envoie un GESTE — préparer, expédier, livrer — jamais l'état
 * d'arrivée. La différence n'est pas cosmétique : accepter `status: 'DELIVERED'`
 * depuis le réseau laisserait sauter les étapes, reculer, ou marquer livrée une
 * commande annulée. C'est `planTransition` (`lib/domain/fulfilment.ts`) qui
 * traduit le geste, à partir de l'état RELU en base.
 *
 * ---------------------------------------------------------------------------
 * Le suivi est facultatif, et il n'est accepté que sur l'expédition
 * ---------------------------------------------------------------------------
 * L'union discriminée le dit dans sa forme : `prepare` et `deliver` n'ont pas
 * de champ de suivi du tout. Un `z.object` unique aurait porté trois champs
 * dont deux ignorés selon les cas — et un jour quelqu'un aurait cru que saisir
 * un numéro en préparation l'enregistrait.
 *
 * Toutes les expéditions n'ont pas de numéro : une petite pièce part parfois en
 * lettre suivie sans numéro exploitable. L'exiger obligerait à en inventer un,
 * ce qui est pire que son absence — l'acheteuse suivrait un colis qui n'existe
 * pas.
 */
export const advanceOrderSchema = z.discriminatedUnion('action', [
  z.object({
    orderId: articleIdSchema,
    action: z.literal('prepare'),
  }),
  z.object({
    orderId: articleIdSchema,
    action: z.literal('ship'),
    /**
     * Vide plutôt qu'absent : un champ de formulaire non rempli arrive comme
     * une chaîne vide, pas comme `undefined`. La traiter comme un numéro
     * inscrirait une expédition dont le suivi serait la chaîne vide — pire
     * qu'aucune, parce qu'elle s'afficherait.
     */
    trackingNumber: z.string().trim().max(MAX_TRACKING_LENGTH).optional(),
    trackingUrl: trackingUrlSchema.optional(),
  }),
  z.object({
    orderId: articleIdSchema,
    action: z.literal('deliver'),
  }),
])

export type AdvanceOrderInput = z.infer<typeof advanceOrderSchema>
