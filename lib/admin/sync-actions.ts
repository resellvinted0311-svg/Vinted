'use server'

import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { recordAudit } from '@/lib/audit/trail'
import { prisma } from '@/lib/db/client'
import { captureException } from '@/lib/observability/sentry'
import {
  pullInventaire,
  PullNotConfiguredError,
  type PullReport,
} from '@/lib/sync/pull'

/**
 * Lancer une synchronisation d'inventaire depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte donc qu'UNE action, et elle commence par
 * `requireAdmin()`.
 *
 * Le middleware protège `/admin`, mais une Server Action n'est pas une page :
 * elle est appelée par un POST vers l'URL de la page qui l'a rendue, et rien
 * n'oblige un appelant à passer par cette page. Ici l'enjeu est direct — sans
 * ce contrôle, n'importe qui ferait tourner des centaines d'écritures en
 * boucle.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce bouton existe, alors que la tâche planifiée fait le travail
 * ---------------------------------------------------------------------------
 * La tâche planifiée passe une fois par jour et reprend là où elle s'est
 * arrêtée : parfaite pour suivre les changements, beaucoup trop lente pour le
 * PREMIER import, qui porte tout le stock d'un coup.
 *
 * Ce bouton fait exactement le même travail, à la demande. L'écran le rappelle
 * jusqu'à ce qu'il ne reste rien — chaque appel reprend où le précédent s'est
 * arrêté, et une pièce déjà à jour ne coûte qu'une lecture.
 */

export type AdminSyncState =
  | { status: 'idle' }
  | {
      status: 'error'
      messageKey: string
      /**
       * Les variables réellement absentes, sur `notConfigured`.
       *
       * Le message les nommait TOUTES LES TROIS, quelle que soit celle qui
       * manquait : on relisait les trois, on en trouvait deux correctes, et on
       * cherchait ailleurs. Un diagnostic qui ne distingue pas ne diagnostique
       * rien.
       */
      missing?: readonly string[]
    }
  | { status: 'done'; report: PullReport }

export async function pullInventaireAction(): Promise<AdminSyncState> {
  // EN PREMIER, avant tout le reste.
  const admin = await requireAdmin()

  /**
   * Compteur sur l'identité prouvée.
   *
   * `sensitive: true` : l'action ÉCRIT dans le catalogue. Laisser passer en cas
   * de panne du compteur donnerait à qui a volé une session le moyen de faire
   * tourner des centaines d'écritures sans limite.
   *
   * Le plafond est large parce que l'usage NORMAL est répétitif : le premier
   * import demande une vingtaine d'appels d'affilée, et un plafond serré
   * bloquerait précisément ce pour quoi ce bouton existe.
   */
  const allowed = await checkRateLimit({
    key: `admin-pull:${admin.id}`,
    limit: 120,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  try {
    /**
     * Quarante secondes, sous le `maxDuration` de la page.
     *
     * La marge paie le rendu de la réponse. Une action tuée par l'hébergeur ne
     * renvoie rien : l'écran resterait à « en cours » sur un travail pourtant
     * fait, et on relancerait sans savoir.
     */
    const report = await pullInventaire({ budgetMs: 40_000 })

    // Une entrée par PASSAGE, et sans aucun chiffre d'affaires ni prix : qui a
    // lancé une écriture de masse sur le catalogue, et quand.
    await recordAudit(prisma, {
      action: 'inventory.pulled',
      entity: 'Article',
      entityId: 'batch',
      actorId: admin.id,
    })

    return { status: 'done', report }
  } catch (error) {
    // Une boutique sans clé de lecture n'est pas en panne : c'est une
    // configuration absente, et l'écran doit dire quoi poser plutôt
    // qu'afficher une erreur interne.
    if (error instanceof PullNotConfiguredError) {
      // Les NOMS des variables absentes, jamais leurs valeurs : ce sont des
      // clés d'accès, et un nom suffit à savoir quoi poser.
      return {
        status: 'error',
        messageKey: 'notConfigured',
        missing: error.manquantes,
      }
    }

    // Tout le reste reste opaque VERS L'ÉCRAN : un message d'exception peut
    // porter un nom de table, une requête, une valeur.
    captureException(error, { event: 'admin.pull_failed' })
    return { status: 'error', messageKey: 'failed' }
  }
}
