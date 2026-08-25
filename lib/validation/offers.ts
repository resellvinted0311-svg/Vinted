import { z } from 'zod'

import { articleIdSchema } from './shop'

/**
 * Validation du dépôt d'une offre.
 *
 * ---------------------------------------------------------------------------
 * Ce que le formulaire n'envoie PAS
 * ---------------------------------------------------------------------------
 * Ni le prix affiché, ni le prix plancher, ni le minimum de la pièce. Tout
 * cela est relu en base au moment de juger l'offre : un montant de référence
 * qui traverse le navigateur est un montant qu'on peut réécrire, et la seule
 * chose qu'il permettrait est de faire accepter automatiquement une offre en
 * annonçant un prix affiché plus bas qu'il ne l'est.
 *
 * Ce qui part d'ici : une pièce, un montant, et — sans compte — une adresse.
 */

/**
 * Montant proposé, en centimes.
 *
 * Les bornes ne sont pas la règle métier : le plancher absolu, le minimum de
 * la pièce et le prix affiché vivent en base et sont appliqués par
 * `lib/domain/offers.ts`. Ce sont des garde-fous de FORME — un entier, positif,
 * qui tienne dans un `Int` PostgreSQL et qui ne soit pas un montant en euros
 * envoyé par erreur.
 */
const amountCents = z
  .number()
  .int('un montant s’exprime en centimes entiers')
  .positive()
  .max(100_000_00)

/**
 * Adresse de réponse, sans compte.
 *
 * Obligatoire dans ce cas et seulement dans celui-là : sans elle, la réponse
 * du vendeur n'atteindrait personne, et l'offre resterait une proposition que
 * son auteur ne pourrait jamais retrouver.
 */
const guestEmail = z.email().trim().toLowerCase().max(320)

export const submitOfferSchema = z.object({
  articleId: articleIdSchema,
  amountCents,
  /** Ignorée quand la personne est connectée : le compte fait foi. */
  email: guestEmail.optional(),
})

export type SubmitOfferInput = z.infer<typeof submitOfferSchema>

/**
 * Réponse du vendeur.
 *
 * `counterAmountCents` n'est exigé que sur une contre-offre. Le rendre toujours
 * obligatoire aurait forcé à inventer une valeur sur un refus.
 */
export const respondOfferSchema = z
  .object({
    offerId: articleIdSchema,
    action: z.enum(['accept', 'reject', 'counter']),
    counterAmountCents: amountCents.optional(),
  })
  .refine(
    (input) =>
      input.action !== 'counter' || input.counterAmountCents !== undefined,
    {
      path: ['counterAmountCents'],
      message: 'une contre-offre a besoin d’un montant',
    },
  )

export type RespondOfferInput = z.infer<typeof respondOfferSchema>

/**
 * Réponse de l'ACHETEUSE à une contre-proposition.
 *
 * Elle n'envoie qu'un identifiant et un verbe. Aucun montant : le prix est
 * celui que la boutique a inscrit, relu en base au moment d'agir. Laisser
 * passer un montant ici reviendrait à laisser choisir son prix.
 */
export const answerCounterSchema = z.object({
  counterOfferId: articleIdSchema,
  answer: z.enum(['accept', 'decline']),
})

export type AnswerCounterInput = z.infer<typeof answerCounterSchema>
