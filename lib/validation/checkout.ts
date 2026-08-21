import { z } from 'zod'
import { emailSchema, localeSchema } from '@/lib/validation/auth'

/**
 * Entrées du tunnel de commande.
 *
 * ---------------------------------------------------------------------------
 * Ce que le client a le droit d'envoyer
 * ---------------------------------------------------------------------------
 * Une adresse, une adresse e-mail, et le CHOIX d'un mode de livraison —
 * transporteur et service, jamais leur prix. Le montant est recalculé
 * intégralement côté serveur à partir du panier et des grilles en base ; celui
 * qu'un navigateur prétend avoir affiché n'entre nulle part.
 *
 * Aucun identifiant d'article non plus : le panier est déjà connu du serveur,
 * il vit en base sous le jeton de session. Le laisser arriver du réseau
 * permettrait d'acheter ce qu'on n'a pas mis dedans.
 */

/** ISO 3166-1 alpha-2, normalisé en majuscules. */
export const countryCodeSchema = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toUpperCase())

/**
 * Code postal.
 *
 * Volontairement permissif sur la forme — les formats nationaux diffèrent trop
 * pour être énumérés sans exclure quelqu'un — mais strictement borné en
 * longueur et en jeu de caractères. La résolution de zone, elle, exige un code
 * postal là où il en faut un et le dit explicitement (`POSTAL_CODE_REQUIRED`).
 */
export const postalCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/)

export const addressSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  postalCode: postalCodeSchema,
  city: z.string().trim().min(1).max(80),
  country: countryCodeSchema,
  phone: z.string().trim().max(30).optional(),
})

export type AddressInput = z.infer<typeof addressSchema>

export const shippingChoiceSchema = z.object({
  carrierCode: z.string().trim().min(1).max(40),
  serviceCode: z.string().trim().min(1).max(40),
  /**
   * Point relais, quand le service en exige un.
   *
   * L'identifiant vient du transporteur ; on ne le fabrique pas et on ne le
   * devine pas. Un service qui en exige un et n'en reçoit pas est refusé.
   */
  servicePointId: z.string().trim().min(1).max(64).optional(),
})

export const startCheckoutSchema = z.object({
  /**
   * Adresse de contact.
   *
   * Obligatoire même avec un compte : c'est là que part la confirmation, et
   * quelqu'un peut vouloir la recevoir ailleurs que sur l'adresse du compte.
   */
  email: emailSchema,
  locale: localeSchema,
  shippingAddress: addressSchema,
  /** Absente : identique à l'adresse de livraison. */
  billingAddress: addressSchema.optional(),
  shipping: shippingChoiceSchema,
  customerNote: z.string().trim().max(500).optional(),
  /**
   * Acceptation des CGV.
   *
   * Le schéma l'exige dès maintenant pour que le tunnel ne soit jamais écrit
   * sans elle. La case reste inactive tant que les CGV ne sont pas rédigées
   * (phase 7), et aucun encaissement réel n'a lieu d'ici là.
   */
  acceptsTerms: z.literal(true),
})

export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>
