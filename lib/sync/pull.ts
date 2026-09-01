import 'server-only'

import { Prisma } from '@prisma/client'

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
  /**
   * Pièces sur lesquelles la boutique a LEVÉ, et qu'elle a passées.
   *
   * Distinct de `refusees`, qui est une décision : ici, quelque chose s'est mal
   * passé. Le compte est affiché parce qu'un import à trous ne doit pas
   * ressembler à un import réussi.
   */
  echouees: number
  /**
   * Les causes des échecs, par code, et leur nombre.
   *
   * Un CODE — `P2002`, `P2028`, `P2024` — et jamais un message : un message
   * d'exception porte des noms de table, des requêtes, parfois des valeurs, et
   * cet écran est une page web. Le code, lui, ne dit rien d'autre que la nature
   * de la panne, et c'est exactement ce qu'il faut pour la corriger.
   *
   * Sans ce relevé, un import qui échoue en masse n'offre qu'un compte : on sait
   * que vingt-trois pièces sont tombées, pas pourquoi — et il faut aller lire
   * des journaux d'hébergeur auxquels on n'a pas toujours accès.
   */
  causes: { code: string; nombre: number }[]
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

/**
 * Le CODE d'une panne, sans rien de ce qu'elle contient.
 *
 * Prisma numérote ses erreurs connues ; c'est cette référence qu'on remonte.
 * Pour le reste, le nom de la classe suffit à distinguer une panne réseau d'une
 * erreur de programmation, et n'expose aucune donnée.
 */
export function codeDePanne(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code
  if (error instanceof Prisma.PrismaClientValidationError) return 'validation'
  if (error instanceof Error) return error.name
  return 'inconnu'
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
  const causes = new Map<string, number>()
  let echouees = 0
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

    /**
     * UNE pièce qui lève ne doit pas emporter le passage entier.
     *
     * -------------------------------------------------------------------------
     * Ce que son absence a coûté
     * -------------------------------------------------------------------------
     * Le module annonce en tête qu'« une pièce rejetée n'annule pas les
     * autres ». C'était vrai des refus de VALIDATION, qui reviennent en
     * résultat — et faux de tout le reste : une exception traversait la boucle,
     * le passage ne rendait aucun compte, et l'écran affichait « la
     * synchronisation a échoué » sur un import qui venait d'en écrire des
     * dizaines.
     *
     * Le cas le plus probable n'a rien d'exotique : deux passages qui se
     * chevauchent — un clic pendant que la tâche planifiée tourne, ou deux
     * onglets — voient tous deux une pièce absente et la créent tous deux. Le
     * second se heurte à l'unicité de `externalId`. Rien n'est perdu : la pièce
     * existe, écrite par l'autre.
     *
     * On compte donc, on journalise, et on continue. Le compte est REMONTÉ à
     * l'écran : une pièce en échec est un incident, dix en sont un autre, et
     * les taire ferait passer un import à trous pour un import réussi.
     */
    try {
      resultats.push(
        await syncArticle(charge, index, context, { dryRun: false }),
      )
    } catch (error) {
      echouees += 1
      const code = codeDePanne(error)
      causes.set(code, (causes.get(code) ?? 0) + 1)
      // L'identifiant de la pièce, jamais son contenu : le journal doit
      // permettre de la retrouver, pas d'en recopier les données.
      logger.failure('sync.pull_piece_failed', error, {
        externalId: String(charge.externalId),
      })
    }

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
    echouees,
    causes: [...causes]
      .sort((a, b) => b[1] - a[1])
      .map(([code, nombre]) => ({ code, nombre })),
    // Les pièces en échec ont bien été VUES : les recompter dans le reste
    // ferait boucler l'écran sur elles indéfiniment.
    reste: charges.length - resultats.length - echouees,
  }
}
