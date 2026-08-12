import { z } from 'zod'
import { locales } from '@/lib/i18n/routing'

/**
 * Schémas partagés client / serveur.
 *
 * Le serveur ne fait jamais confiance à une validation déjà passée côté
 * client : ces schémas sont rejoués dans chaque Server Action.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .pipe(z.email())
  .transform((value) => value.toLowerCase())

/**
 * 12 caractères minimum, sans règle de composition.
 *
 * Les exigences de « 1 majuscule + 1 chiffre + 1 symbole » produisent des mots
 * de passe plus courts et plus prévisibles. La longueur est ce qui protège.
 */
export const passwordSchema = z.string().min(12).max(200)

export const localeSchema = z.enum(locales)

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  locale: localeSchema,
  /** Consentement marketing : distinct des CGV, jamais pré-coché. */
  marketingConsent: z.boolean().default(false),
})

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
})

export const magicLinkSchema = z.object({
  email: emailSchema,
  locale: localeSchema,
})

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
  locale: localeSchema,
})

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
export type MagicLinkInput = z.infer<typeof magicLinkSchema>
