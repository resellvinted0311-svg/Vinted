import { NextResponse, type NextRequest } from 'next/server'

import {
  DemoSettingsInProductionError,
  MissingSettingError,
} from '@/lib/config/settings'
import { logger } from '@/lib/observability/logger'
import { checkRateLimit } from '@/lib/security/rate-limit'
import {
  appEventSchema,
  deciderAppEvent,
  type AppRow,
} from '@/lib/sync/app-event'
import { loadSyncContext, syncArticle } from '@/lib/sync/articles'
import { codeDePanne } from '@/lib/sync/pull'
import { authenticateSync } from '@/lib/sync/auth'
import { traduire, type LigneInventaire } from '@/lib/sync/inventaire-app'

/**
 * Une pièce ajoutée dans l'application paraît TOUT DE SUITE en boutique.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette route, alors que la synchronisation tourne déjà
 * ---------------------------------------------------------------------------
 * Le passage quotidien et le bouton de régie relisent l'inventaire ENTIER pour
 * retrouver ce qui a bougé. C'est ce qu'il faut quand on ne sait pas quoi
 * chercher — et c'est absurde quand on le sait : mille lignes lues pour une
 * pièce ajoutée, et jusqu'à vingt-quatre heures d'attente.
 *
 * La base de l'application, elle, sait exactement QUAND une ligne change. Un
 * webhook de base Supabase appelle donc cette route à chaque insertion,
 * modification ou suppression, et la boutique n'a plus qu'une pièce à traiter.
 *
 * Cela ne remplace pas le passage quotidien, cela le complète : un webhook peut
 * se perdre — panne réseau, boutique en cours de déploiement — et le balayage
 * rattrape alors ce qui manque. Une notification perdue devient un retard,
 * jamais une pièce oubliée.
 *
 * ---------------------------------------------------------------------------
 * Aucun code à écrire dans l'application
 * ---------------------------------------------------------------------------
 * C'est ce qui rend ce chemin possible aujourd'hui : le webhook se déclare dans
 * la console Supabase, sur la table `articles`. L'architecture visée reste
 * « l'application pousse » ; ceci en est la forme réalisable sans toucher à un
 * dépôt auquel on n'a pas accès.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Une pièce, pas un lot : quelques secondes suffisent largement.
 *
 * Une borne courte est ici une PROTECTION. Cette adresse est publique, et une
 * fonction qui s'attarde est une fonction qu'on peut faire s'attarder.
 */
export const maxDuration = 30

function reponse(
  status: number,
  corps: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(corps, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** La ligne reçue, dans la forme que la traduction attend. */
function versLigneInventaire(ligne: AppRow): LigneInventaire {
  return {
    id: ligne.id,
    article: ligne.article ?? null,
    marque: ligne.marque ?? null,
    taille: ligne.taille ?? null,
    etat: ligne.etat ?? null,
    couleur: ligne.couleur ?? null,
    description: ligne.description ?? null,
    prix_achat: ligne.prix_achat ?? null,
    prix_annonce: ligne.prix_annonce ?? null,
    prix_vendu: ligne.prix_vendu ?? null,
    en_vente: ligne.en_vente ?? null,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ---- Authentification --------------------------------------------------
  //
  // La MÊME clé que l'import par lot : c'est le même droit — écrire dans le
  // catalogue — et un second secret pour le même droit serait un secret de plus
  // à faire tourner, à poser, et à oublier quelque part.
  const caller = authenticateSync(request.headers.get('authorization'))
  if (!caller) {
    return reponse(401, { ok: false, reason: 'unauthorized' })
  }

  // ---- Débit -------------------------------------------------------------
  //
  // `sensitive: true` : la route ÉCRIT. Laisser passer pendant une panne du
  // compteur donnerait à qui détient la clé un moyen d'écrire sans limite.
  //
  // Le plafond est haut parce qu'une saisie en rafale est un usage NORMAL :
  // enregistrer trente pièces d'affilée dans l'application déclenche trente
  // appels, et les refuser ferait perdre exactement ce que cette route apporte.
  const allowed = await checkRateLimit({
    key: `sync:app-event:${caller.counterKey}`,
    limit: 300,
    windowSeconds: 60,
    sensitive: true,
  })
  if (!allowed) {
    return reponse(429, { ok: false, reason: 'rate-limited' })
  }

  // ---- Charge utile ------------------------------------------------------
  let brut: unknown
  try {
    brut = await request.json()
  } catch {
    return reponse(400, { ok: false, reason: 'invalid-json' })
  }

  const lu = appEventSchema.safeParse(brut)
  if (!lu.success) {
    return reponse(400, { ok: false, reason: 'invalid-payload' })
  }

  /**
   * L'espace de travail attendu.
   *
   * Sans lui configuré, on REFUSE plutôt que d'accepter tout : un webhook posé
   * sur une base multi-locataire enverrait les lignes de tout le monde, et une
   * variable oubliée ne doit pas se traduire par « publie ce qui vient ».
   */
  const workspaceId = process.env.APP_WORKSPACE_ID?.trim()
  if (!workspaceId) {
    logger.info('sync.app_event_no_workspace', {})
    return reponse(503, { ok: false, reason: 'shop-not-configured' })
  }

  const decision = deciderAppEvent(lu.data, workspaceId)

  if (decision.action === 'ignore') {
    // 200 et non 4xx : l'émetteur n'a rien fait de mal, et un webhook Supabase
    // qui reçoit une erreur réessaie. Réessayer une ligne qu'on ignore par
    // construction ne ferait que boucler.
    return reponse(200, { ok: true, ignored: decision.motif })
  }

  const traduite = traduire(versLigneInventaire(decision.ligne))
  if ('refus' in traduite) {
    /**
     * La pièce est incomplète du côté de l'application. Ce n'est pas une panne :
     * on le dit, sans réessayer.
     *
     * Et on dit AVEC QUOI. « sans-etat » seul ne distingue pas une colonne vide
     * d'un libellé que la table ne connaît pas — deux corrections opposées :
     * remplir une donnée, ou élargir une liste. Il a fallu aller lire la ligne
     * en base pour trancher, la première fois.
     *
     * La valeur ne sort que vers un appelant AUTHENTIFIÉ, qui est par
     * construction le propriétaire de la donnée : on lui montre ce qu'il vient
     * lui-même de saisir.
     */
    return reponse(200, {
      ok: true,
      skipped: traduite.refus,
      ...(traduite.valeur ? { value: traduite.valeur } : {}),
    })
  }

  /**
   * Une suppression ARCHIVE, elle ne supprime pas.
   *
   * La charge traduite porte déjà le statut déduit de l'application ; on le
   * force ici parce que la ligne n'existe plus là-bas, quoi qu'elle ait dit.
   */
  const charge =
    decision.action === 'archive'
      ? { ...traduite.charge, status: 'ARCHIVED' as const }
      : traduite.charge

  try {
    const context = await loadSyncContext()
    const resultat = await syncArticle(charge, 0, context, { dryRun: false })

    return reponse(resultat.action === 'rejected' ? 422 : 200, {
      ok: resultat.action !== 'rejected',
      action: resultat.action,
      ...(resultat.reason ? { reason: resultat.reason } : {}),
    })
  } catch (error) {
    // Une boutique mal configurée n'est pas une panne, et ne doit pas se lire
    // comme telle — même raisonnement que la route d'import par lot.
    if (
      error instanceof DemoSettingsInProductionError ||
      error instanceof MissingSettingError
    ) {
      return reponse(503, { ok: false, reason: 'shop-not-configured' })
    }

    /**
     * Le CODE de la panne remonte, son MESSAGE non.
     *
     * Un message d'exception porte des noms de table, des requêtes, parfois des
     * valeurs : il part au journal. Le code — `P2002`, `P2028`, `P2024` — ne dit
     * que la nature de la panne, et c'est exactement ce qu'il faut pour la
     * corriger.
     *
     * Sans lui, un `internal-error` obligeait à aller lire les journaux de
     * l'hébergeur — auxquels on n'a pas toujours accès. La réponse, elle, est
     * consignée par l'appelant : c'est là qu'il faut mettre de quoi diagnostiquer.
     */
    logger.failure('sync.app_event_failed', error)
    return reponse(500, {
      ok: false,
      reason: 'internal-error',
      code: codeDePanne(error),
    })
  }
}
