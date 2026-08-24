import { z } from 'zod'

/**
 * Validation des actions d'exercice des droits.
 *
 * Ces deux formulaires étaient les seuls du projet à lire `FormData`
 * directement, sans schéma — sur un fichier qui efface des comptes et qui
 * détruit une preuve de consentement. Le brief l'exige partout : « validation
 * Zod sur toute entrée, y compris les Server Actions ».
 */

/**
 * Le mot de la confirmation d'effacement.
 *
 * Exporté pour que le formulaire et l'action lisent la MÊME valeur : elle est
 * comparée côté serveur et affichée côté client, et deux littérales séparées
 * finissent par diverger — rendant la suppression impossible sans que rien
 * n'échoue à la compilation.
 *
 * Ce n'est pas un secret et cela ne prétend pas l'être : le mot voyage dans le
 * bundle. Il protège du clic malencontreux, pas d'un tiers — c'est la
 * re-saisie du mot de passe qui s'en charge.
 */
export const ERASE_CONFIRMATION_WORD = 'EFFACER'

export const eraseAccountSchema = z.object({
  confirm: z.literal(ERASE_CONFIRMATION_WORD),
  /**
   * Absent sur un compte sans mot de passe (inscrit par lien magique
   * uniquement). L'action tranche : elle l'exige dès qu'une empreinte existe.
   */
  password: z.string().min(1).max(200).optional(),
})

/**
 * Consentement marketing.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un champ témoin en plus de la case
 * ---------------------------------------------------------------------------
 * Une case décochée n'est PAS envoyée par le navigateur : le serveur ne reçoit
 * rien. Il ne pouvait donc pas distinguer « la personne a décoché » d'« une
 * requête tronquée, ou forgée sans ce champ » — et les deux étaient traitées
 * comme un retrait, ce qui met `marketingConsentAt` à NULL et DÉTRUIT la
 * preuve horodatée que le consentement avait été donné.
 *
 * Le champ témoin est toujours envoyé, lui. S'il manque, la requête n'est pas
 * une soumission de ce formulaire, et on ne touche à rien.
 */
export const MARKETING_CONSENT_FORM = 'marketing-consent'

export const marketingConsentSchema = z.object({
  form: z.literal(MARKETING_CONSENT_FORM),
  /** `'on'` quand la case est cochée ; absente sinon. */
  marketingConsent: z.literal('on').optional(),
})

export type EraseAccountInput = z.infer<typeof eraseAccountSchema>
export type MarketingConsentInput = z.infer<typeof marketingConsentSchema>
