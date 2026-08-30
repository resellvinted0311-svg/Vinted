/**
 * Importer l'inventaire de l'application dans la boutique.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un script, et pas la synchronisation automatique
 * ---------------------------------------------------------------------------
 * Le contrat de `docs/synchronisation.md` décrit l'application POUSSANT ses
 * pièces vers la boutique. C'est la bonne architecture et elle reste la cible.
 * Mais elle demande du code DANS l'application, qui n'est pas ce dépôt.
 *
 * Ce script fait le même travail depuis un poste : il lit l'inventaire, traduit
 * ses champs vers le contrat, et appelle la même route publique
 * `POST /api/sync/articles` avec la même clé. Rien de privilégié, aucun chemin
 * dérobé — ce que fera l'application le jour venu, en attendant qu'elle le
 * fasse.
 *
 * ---------------------------------------------------------------------------
 * La boutique ne reçoit JAMAIS les identifiants de l'inventaire
 * ---------------------------------------------------------------------------
 * C'est la raison d'être de la forme « script » plutôt que « la boutique va
 * lire la base de l'application ». Cette base est multi-locataire : elle
 * contient l'inventaire de cent trente espaces de travail, dont la plupart
 * appartiennent à d'autres personnes. Une clé de service posée dans les
 * variables d'environnement de la boutique ferait d'une intrusion sur la
 * boutique une fuite des stocks de tous ces clients — et le responsable de
 * traitement, au sens du RGPD, c'est vous.
 *
 * Ici la clé ne quitte pas le poste qui lance le script, et la lecture est
 * bornée à UN espace de travail, le vôtre, par `APP_WORKSPACE_ID`.
 *
 * ---------------------------------------------------------------------------
 * Simulation par défaut
 * ---------------------------------------------------------------------------
 * Sans `--pour-de-vrai`, rien n'est écrit : la boutique est appelée en essai à
 * blanc et répond ce qu'elle FERAIT. Un import de plusieurs centaines de pièces
 * ne se lance pas sur une intention.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   APP_SUPABASE_URL=https://xxxx.supabase.co \
 *   APP_SUPABASE_SERVICE_KEY=... \
 *   APP_WORKSPACE_ID=... \
 *   BOUTIQUE_URL=https://exemple.vercel.app \
 *   SYNC_API_KEY=... \
 *   npx tsx scripts/importer-inventaire.ts [--pour-de-vrai] [--limite=50]
 */

import { MAX_BATCH_SIZE } from '../lib/validation/sync'
import {
  COLONNES,
  traduire,
  type LigneInventaire,
  type Refus,
} from './inventaire-mapping'

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

function exigerVariable(nom: string): string {
  const valeur = process.env[nom]
  if (!valeur || valeur.trim() === '') {
    console.error(`Variable d’environnement manquante : ${nom}`)
    process.exit(1)
  }
  return valeur.trim()
}

// ---------------------------------------------------------------------------
// Lecture de l'inventaire
// ---------------------------------------------------------------------------

async function lireInventaire(
  base: string,
  cle: string,
  workspaceId: string,
  limite: number | null,
): Promise<LigneInventaire[]> {
  const lignes: LigneInventaire[] = []
  const parPage = 1000
  let decalage = 0

  for (;;) {
    const url = new URL('/rest/v1/articles', base)
    url.searchParams.set('select', COLONNES)
    // Borné à VOTRE espace de travail. La base en contient d'autres, qui
    // appartiennent à d'autres personnes : les lire serait un traitement sans
    // finalité, et les importer, une fuite.
    url.searchParams.set('workspace_id', `eq.${workspaceId}`)
    url.searchParams.set('order', 'created_at.asc')
    url.searchParams.set('limit', String(parPage))
    url.searchParams.set('offset', String(decalage))

    const reponse = await fetch(url, {
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
    })

    if (!reponse.ok) {
      console.error(
        `Lecture de l’inventaire refusée : ${reponse.status} ${await reponse.text()}`,
      )
      process.exit(1)
    }

    const page = (await reponse.json()) as LigneInventaire[]
    lignes.push(...page)

    if (page.length < parPage) break
    if (limite !== null && lignes.length >= limite) break
    decalage += parPage
  }

  return limite === null ? lignes : lignes.slice(0, limite)
}

// ---------------------------------------------------------------------------
// Envoi vers la boutique
// ---------------------------------------------------------------------------

interface ResultatBoutique {
  externalId: string
  action: string
  reason?: string
  detail?: string
}

async function envoyer(
  boutique: string,
  cle: string,
  articles: Record<string, unknown>[],
  essaiABlanc: boolean,
): Promise<ResultatBoutique[]> {
  const url = new URL('/api/sync/articles', boutique)
  if (essaiABlanc) url.searchParams.set('dryRun', '1')

  const reponse = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cle}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ articles }),
  })

  const corps = (await reponse.json()) as {
    results?: ResultatBoutique[]
    error?: string
    message?: string
  }

  // 200 tout passe, 207 lot mixte, 422 tout refusé : dans les trois cas la
  // réponse porte le détail pièce par pièce, et c'est lui qui nous intéresse.
  // Une réponse SANS `results` est autre chose — clé refusée, débit fermé,
  // corps illisible — et là il n'y a rien à interpréter.
  if (!corps.results) {
    console.error(
      `Réponse inattendue de la boutique (${reponse.status}) : ${
        corps.error ?? corps.message ?? JSON.stringify(corps)
      }`,
    )
    process.exit(1)
  }

  return corps.results
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function compter(valeurs: readonly string[]): Map<string, number> {
  const total = new Map<string, number>()
  for (const valeur of valeurs) total.set(valeur, (total.get(valeur) ?? 0) + 1)
  return total
}

function tableau(titre: string, comptes: Map<string, number>): void {
  if (comptes.size === 0) return
  console.log(`\n${titre}`)
  for (const [libelle, nombre] of [...comptes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(nombre).padStart(5)}  ${libelle}`)
  }
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = process.argv.slice(2)
  const essaiABlanc = !options.includes('--pour-de-vrai')
  const limiteBrute = options.find((a) => a.startsWith('--limite='))?.split('=')[1]
  const limite = limiteBrute === undefined ? null : Number(limiteBrute)

  if (limite !== null && (!Number.isInteger(limite) || limite <= 0)) {
    console.error('--limite attend un entier positif')
    process.exit(1)
  }

  const appUrl = exigerVariable('APP_SUPABASE_URL')
  const appCle = exigerVariable('APP_SUPABASE_SERVICE_KEY')
  const workspaceId = exigerVariable('APP_WORKSPACE_ID')
  const boutique = exigerVariable('BOUTIQUE_URL')
  const syncCle = exigerVariable('SYNC_API_KEY')

  console.log(
    essaiABlanc
      ? 'ESSAI À BLANC — la boutique ne sera pas modifiée.'
      : 'ÉCRITURE RÉELLE dans la boutique.',
  )

  const lignes = await lireInventaire(appUrl, appCle, workspaceId, limite)
  console.log(`\n${lignes.length} pièces lues dans l’inventaire.`)

  const charges: Record<string, unknown>[] = []
  const refus: Refus[] = []
  const rangements: string[] = []
  let tronquees = 0

  for (const ligne of lignes) {
    const traduite = traduire(ligne)
    if ('refus' in traduite) {
      refus.push(traduite.refus)
      continue
    }
    charges.push(traduite.charge)
    rangements.push(`${traduite.categorie} · ${traduite.statut}`)
    if (traduite.tronquee) tronquees += 1
  }

  tableau('Catégories déduites du libellé — À VÉRIFIER :', compter(rangements))
  tableau('Pièces écartées avant l’envoi :', compter(refus))
  if (tronquees > 0) {
    console.log(
      `\n  ${tronquees} titre(s) ou taille(s) tronqué(s) aux bornes du contrat.`,
    )
  }

  if (charges.length === 0) {
    console.log('\nRien à envoyer.')
    return
  }

  console.log(`\n${charges.length} pièces à envoyer, par lots de ${MAX_BATCH_SIZE}.`)

  const actions: string[] = []
  const motifs: string[] = []

  for (let debut = 0; debut < charges.length; debut += MAX_BATCH_SIZE) {
    const lot = charges.slice(debut, debut + MAX_BATCH_SIZE)
    const resultats = await envoyer(boutique, syncCle, lot, essaiABlanc)

    for (const resultat of resultats) {
      actions.push(resultat.action)
      if (resultat.reason) {
        motifs.push(`${resultat.reason} — ${resultat.detail ?? ''}`.trim())
      }
    }

    console.log(`  lot ${Math.floor(debut / MAX_BATCH_SIZE) + 1} : ${lot.length} pièces`)
  }

  tableau('Réponse de la boutique :', compter(actions))
  tableau('Motifs de refus :', compter(motifs))

  if (essaiABlanc) {
    console.log(
      '\nAucune écriture n’a eu lieu. Relancez avec --pour-de-vrai pour appliquer.',
    )
  }
}

main().catch((erreur: unknown) => {
  console.error(erreur)
  process.exit(1)
})
