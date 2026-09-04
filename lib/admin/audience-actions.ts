'use server'

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { qualifyAudienceSchema } from '@/lib/validation/article'
import {
  qualifyArticles,
  audiencePathsToRevalidate,
} from '@/lib/articles/audiences'

/**
 * Ranger des pièces dans un univers, depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — `'use server'` rend PUBLIC tout ce que ce fichier exporte
 * ---------------------------------------------------------------------------
 * Le middleware protège `/admin`, mais une action serveur n'est pas une page :
 * elle s'appelle par un POST vers l'URL qui l'a rendue, et rien n'oblige
 * l'appelant à passer par cette page. D'où `requireAdmin()` en première ligne,
 * dans l'action elle-même — jamais uniquement dans le middleware.
 *
 * L'enjeu ici est la vitrine : sans ce contrôle, n'importe qui rangerait tout
 * le registre en « homme » et viderait la vitrine Femme d'un seul envoi.
 */

export type AudienceActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  /** `updated` est le nombre RÉELLEMENT écrit, pas le nombre demandé. */
  | { status: 'qualified'; updated: number; requested: number }

const ERROR = (messageKey: string): AudienceActionState => ({
  status: 'error',
  messageKey,
})

export async function qualifyAudienceAction(
  _previous: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const admin = await requireAdmin()

  // Le plafond ne protège pas d'une administratrice malveillante — rien ne le
  // peut à ce niveau de droits — mais du script qui boucle : chaque envoi
  // ouvre une transaction, et la production n'accorde qu'une connexion par
  // instance.
  const allowed = await checkRateLimit({
    key: `audience-qualify:${admin.id}`,
    limit: 120,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return ERROR('rateLimited')

  // `getAll` et non `get` : les cases cochées arrivent sous le MÊME nom, et
  // `get` n'en rendrait que la première — un lot de trente pièces se
  // réduirait silencieusement à une seule.
  const parsed = qualifyAudienceSchema.safeParse({
    audience: formData.get('audience'),
    articleIds: formData.getAll('articleIds').filter((v) => typeof v === 'string'),
  })
  if (!parsed.success) return ERROR('invalidRequest')

  const result = await qualifyArticles(
    parsed.data.articleIds,
    parsed.data.audience,
    admin.id,
  )
  if (!result.ok) return ERROR(result.reason)

  // Seulement si quelque chose a bougé : purger le cache d'un site entier
  // pour un envoi qui n'a rien écrit est du travail pur, et sur un
  // double-clic il se paie deux fois.
  if (result.updated > 0) {
    for (const path of audiencePathsToRevalidate()) revalidatePath(path)
  }

  return {
    status: 'qualified',
    updated: result.updated,
    requested: parsed.data.articleIds.length,
  }
}
