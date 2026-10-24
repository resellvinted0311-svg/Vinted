import { z } from 'zod'
import { emailSchema, localeSchema } from '@/lib/validation/auth'

/**
 * La déclaration de rétractation en ligne.
 *
 * Les trois éléments que la directive permet de demander, et pas un de plus
 * (directive 2011/83, art. 11 bis, inséré par la directive 2023/2673) : le
 * nom, de quoi identifier le contrat, et le moyen électronique par lequel
 * l'accusé de réception sera envoyé. Exiger davantage — un motif, une case à
 * cocher, un compte — ferait obstacle à un droit qui s'exerce « sans avoir à
 * se justifier ».
 */

/**
 * Le numéro de commande, tel que le tunnel l'écrit : `CMD-2026-000123`.
 *
 * Normalisé avant d'être contrôlé : recopié depuis un e-mail, il arrive
 * souvent en minuscules ou entouré d'espaces, et le refuser pour cela
 * reviendrait à refuser la rétractation pour une faute de frappe.
 */
export const orderNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CMD-\d{4}-\d{6}$/)

export const withdrawalSchema = z.object({
  name: z.string().trim().min(2).max(120),
  orderNumber: orderNumberSchema,
  email: emailSchema,
  locale: localeSchema,
})

export type WithdrawalInput = z.infer<typeof withdrawalSchema>
