import 'server-only'

import { prisma } from '@/lib/db/client'
import { logger } from '@/lib/observability/logger'
import {
  loadSyncContext,
  resteAssezDeTemps,
  syncArticle,
  type SyncResult,
} from '@/lib/sync/articles'
import {
  COLONNES,
  traduire,
  type LigneInventaire,
} from '@/lib/sync/inventaire-app'

/**
 * La boutique VA CHERCHER l'inventaire dans l'application de gestion.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce sens, alors que le contrat décrit l'inverse
 * ---------------------------------------------------------------------------
 * `docs/synchronisation.md` décrit l'application POUSSANT ses pièces. C'est la
 * meilleure architecture et elle reste la cible : c'est l'application qui sait
 * QUAND une pièce change, et elle n'a alors aucune raison d'envoyer les mille
 * autres.
 *
 * Elle demande du code dans l'application, qui est un autre dépôt. En
 * attendant, deux chemins font le même travail : `scripts/importer-inventaire`
 * depuis un poste, et ce module depuis la tâche planifiée de la boutique. Les
 * trois partagent la même traduction (`lib/sync/inventaire-app.ts`) et la même
 * écriture (`syncArticle`) — aucun ne range une pièce autrement que les autres.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce sens COÛTE, et qu'il faut avoir en tête
 * ---------------------------------------------------------------------------
 * Il oblige la boutique à détenir une clé de lecture sur la base de
 * l'application. Cette base est multi-locataire : une intrusion sur la boutique
 * donnerait accès aux stocks de ses autres espaces de travail. Le document le
 * dit, et le dit toujours — c'est pourquoi le sens « l'application pousse »
 * reste la cible, et pourquoi ce module lit le MINIMUM : les seules colonnes
 * nommées par `COLONNES`, et uniquement les lignes de `APP_WORKSPACE_ID`.
 *
 * La contrepartie est assumée et connue : sans elle, la synchronisation
 * réclamait un terminal et cinq variables rechargées à chaque fois, ce qui
 * revenait à ne pas synchroniser du tout.
 *
 * ---------------------------------------------------------------------------
 * Un passage BORNÉ, jamais l'inventaire entier
 * ---------------------------------------------------------------------------
 * Une fonction serverless a quelques dizaines de secondes. Mille pièces n'y
 * tiennent pas, et une fonction tuée en chemin n'écrit ni ne dit rien.
 *
 * On s'arrête donc de soi-même, comme la route d'import : on mesure la pièce la
 * plus lente et on n'en entame pas une nouvelle si elle ne tient pas dans ce qui
 * reste. Ce qui n'a pas été vu le sera au passage suivant — et depuis
 * l'empreinte de synchronisation, une pièce déjà à jour ne coûte qu'une lecture.
 */

/** Ce qu'un passage a fait, pour le journal et pour l'écran de régie. */
export interface PullReport {
  /** Lignes lues dans l'inventaire de l'application. */
  lues: number
  /** Pièces que la traduction a écartées — libellé, état, taille, prix. */
  ecartees: number
  /** Pièces réellement examinées par la boutique pendant ce passage. */
  examinees: number
  creees: number
  misesAJour: number
  inchangees: number
  refusees: number
  /** Reste-t-il des pièces non examinées ? Un passage de plus les prendra. */
  reste: number
}

export class PullNotConfiguredError extends Error {
  constructor(readonly manquantes: readonly string[]) {
    super(
      `Lecture de l’inventaire impossible : ${manquantes.join(', ')} ` +
        `absente(s) des variables d’environnement de la boutique.`,
    )
    this.name = 'PullNotConfiguredError'
  }
}

const VARIABLES = [
  'APP_SUPABASE_URL',
  'APP_SUPABASE_SERVICE_KEY',
  'APP_WORKSPACE_ID',
] as const

/**
 * Les trois variables, lues d'un coup.
 *
 * Toutes nommées ensemble, jamais la première venue : elles s'ajoutent en une
 * fois et manquent donc en une fois. Signaler la première obligerait à un
 * aller-retour par variable, chacun payé d'un passage de tâche planifiée.
 */
function lireConfiguration(): {
  url: string
  cle: string
  workspaceId: string
} {
  const manquantes = VARIABLES.filter((nom) => {
    const valeur = process.env[nom]
    return !valeur || valeur.trim() === ''
  })

  if (manquantes.length > 0) throw new PullNotConfiguredError(manquantes)

  return {
    url: (process.env.APP_SUPABASE_URL as string).trim(),
    cle: (process.env.APP_SUPABASE_SERVICE_KEY as string).trim(),
    workspaceId: (process.env.APP_WORKSPACE_ID as string).trim(),
  }
}

/** Lignes d'inventaire de l'espace de travail, par pages de mille. */
async function lireInventaire(
  url: string,
  cle: string,
  workspaceId: string,
): Promise<LigneInventaire[]> {
  const lignes: LigneInventaire[] = []
  const parPage = 1000

  for (let decalage = 0; ; decalage += parPage) {
    const cible = new URL('/rest/v1/articles', url)
    cible.searchParams.set('select', COLONNES)
    // Borné à CET espace de travail. La base en contient d'autres, qui
    // appartiennent à d'autres personnes : les lire serait un traitement sans
    // finalité, et les importer, une fuite.
    cible.searchParams.set('workspace_id', `eq.${workspaceId}`)
    cible.searchParams.set('order', 'created_at.asc')
    cible.searchParams.set('limit', String(parPage))
    cible.searchParams.set('offset', String(decalage))

    const reponse = await fetch(cible, {
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
      cache: 'no-store',
    })

    if (!reponse.ok) {
      // Le corps peut contenir la requête et des noms de colonnes : il part
      // dans le journal, jamais dans une réponse.
      logger.failure(
        'sync.pull_read_failed',
        new Error(`PostgREST ${reponse.status}`),
      )
      throw new Error(
        `l’inventaire de l’application a refusé la lecture (${reponse.status})`,
      )
    }

    const page = (await reponse.json()) as LigneInventaire[]
    lignes.push(...page)
    if (page.length < parPage) return lignes
  }
}

/**
 * Un passage de synchronisation.
 *
 * `budgetMs` borne le temps TOTAL du passage, lecture de l'inventaire comprise
 * — c'est pourquoi l'horloge démarre avant elle. Chaque appelant en garde une
 * part pour rendre sa réponse : une fonction tuée avant de répondre ne dit pas
 * ce qu'elle a écrit, et on relance sans savoir.
 *
 * Ce qui n'a pas été examiné figure dans `reste` — le passage suivant s'en
 * chargera, et depuis l'empreinte de synchronisation, ce qui est déjà à jour ne
 * coûte qu'une lecture.
 */
export async function pullInventaire({
  budgetMs,
  maintenant = () => Date.now(),
}: {
  budgetMs: number
  maintenant?: () => number
}): Promise<PullReport> {
  const { url, cle, workspaceId } = lireConfiguration()
  const commenceA = maintenant()

  const lignes = await lireInventaire(url, cle, workspaceId)

  const charges: Record<string, unknown>[] = []
  let ecartees = 0

  for (const ligne of lignes) {
    const traduite = traduire(ligne)
    if ('refus' in traduite) {
      ecartees += 1
      continue
    }
    charges.push(traduite.charge)
  }

  /**
   * L'ordre de passage : les pièces les moins récemment synchronisées d'abord.
   *
   * Sans lui, un passage borné reprendrait toujours les mêmes premières pièces
   * et les dernières ne seraient JAMAIS vues — l'inventaire paraîtrait
   * synchronisé alors qu'une part n'aurait jamais été touchée. Une pièce
   * inconnue de la boutique n'a pas de date : elle passe en tête, ce qui est
   * exactement ce qu'on veut d'un premier import.
   */
  const connues = await prisma.article.findMany({
    where: { externalId: { in: charges.map((c) => String(c.externalId)) } },
    select: { externalId: true, externalSyncedAt: true },
  })
  const vuesLe = new Map(
    connues.map((row) => [row.externalId, row.externalSyncedAt?.getTime() ?? 0]),
  )
  charges.sort(
    (a, b) =>
      (vuesLe.get(String(a.externalId)) ?? 0) -
      (vuesLe.get(String(b.externalId)) ?? 0),
  )

  const context = await loadSyncContext()
  const resultats: SyncResult[] = []
  let piecePlusLenteMs = 0

  for (const [index, charge] of charges.entries()) {
    const continuer = resteAssezDeTemps({
      index,
      ecouleMs: maintenant() - commenceA,
      piecePlusLenteMs,
      budgetMs,
    })
    if (!continuer) break

    const avant = maintenant()
    resultats.push(await syncArticle(charge, index, context, { dryRun: false }))
    piecePlusLenteMs = Math.max(piecePlusLenteMs, maintenant() - avant)
  }

  const compter = (action: SyncResult['action']): number =>
    resultats.filter((resultat) => resultat.action === action).length

  return {
    lues: lignes.length,
    ecartees,
    examinees: resultats.length,
    creees: compter('created'),
    misesAJour: compter('updated'),
    inchangees: compter('unchanged'),
    refusees: compter('rejected'),
    reste: charges.length - resultats.length,
  }
}
