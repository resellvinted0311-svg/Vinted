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
 *                                          [--taille-lot=25]  (défaut : 25)
 */

import { MAX_BATCH_SIZE } from '../lib/validation/sync'
import {
  COLONNES,
  INTERVALLE_ENTRE_LOTS_MS,
  TAILLE_LOT_DEFAUT,
  conseilPourRefus,
  lireReponseBrute,
  motsDeTete,
  traduire,
  type LigneInventaire,
  type Refus,
  type ResultatBoutique,
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

async function envoyer(
  boutique: string,
  cle: string,
  articles: Record<string, unknown>[],
  essaiABlanc: boolean,
): Promise<{ resultats: ResultatBoutique[]; reportees: number }> {
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

  // Le TEXTE, pas `.json()`. Une fonction tuée avant d'avoir répondu rend un
  // corps vide, et `.json()` échouait alors sur un `SyntaxError` accompagné
  // d'une pile d'appels internes à Node — rien qui désigne la cause.
  const texte = await reponse.text()

  // 200 tout passe, 207 lot mixte, 422 tout refusé : dans les trois cas la
  // réponse porte le détail pièce par pièce, et c'est lui qui nous intéresse.
  // Tout le reste est un refus en bloc, et doit se lire comme tel.
  const lecture = lireReponseBrute(reponse.status, texte)

  if ('refusGlobal' in lecture) {
    const refus = lecture.refusGlobal
    console.error(`\nLa boutique a refusé le lot ENTIER — ${refus.status} ${refus.reason}`)
    if (refus.detail) console.error(`  ${refus.detail}`)
    console.error(`\n${conseilPourRefus(refus)}`)
    process.exit(1)
  }

  return { resultats: lecture.resultats, reportees: lecture.reportees }
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

  /**
   * Taille des lots envoyés.
   *
   * Le contrat en autorise cent, mais cent pièces font cent transactions dans
   * une seule requête : selon la latence de la base, la fonction peut être tuée
   * avant d'avoir répondu. Pouvoir descendre est ce qui permet de terminer un
   * import au lieu de buter dessus.
   *
   * Le défaut n'est plus ce maximum : voir `TAILLE_LOT_DEFAUT`. Il l'a été, et
   * le premier import réel s'est arrêté sur un dépassement de temps.
   */
  const lotBrut = options.find((a) => a.startsWith('--taille-lot='))?.split('=')[1]
  const tailleLot = lotBrut === undefined ? TAILLE_LOT_DEFAUT : Number(lotBrut)

  if (!Number.isInteger(tailleLot) || tailleLot <= 0 || tailleLot > MAX_BATCH_SIZE) {
    console.error(`--taille-lot attend un entier entre 1 et ${MAX_BATCH_SIZE}`)
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

  /**
   * Quelques libellés écartés, par motif.
   *
   * Un décompte — « 394 catégorie-indéduisible » — ne dit pas quoi corriger. Il
   * laisse croire que les libellés sont incomplets, alors que la cause la plus
   * fréquente est l'inverse : ils nomment un vêtement que la table de mots ne
   * connaît pas encore. Sans exemples, personne ne peut trancher.
   */
  const exemples = new Map<Refus, string[]>()
  const MAX_EXEMPLES = 8

  /**
   * TOUS les libellés dont la catégorie n'a pas pu être déduite.
   *
   * Gardés en entier — et non huit d'entre eux — pour le décompte des premiers
   * mots, qui est ce qui dit quels mots ajouter à la table et ce que chacun
   * rapporterait. Voir `motsDeTete`.
   */
  const libellesIndeduisibles: string[] = []

  let tronquees = 0

  for (const ligne of lignes) {
    const traduite = traduire(ligne)
    if ('refus' in traduite) {
      refus.push(traduite.refus)

      const deja = exemples.get(traduite.refus) ?? []
      const libelle = (ligne.article ?? '').trim()
      if (deja.length < MAX_EXEMPLES && libelle !== '') {
        exemples.set(traduite.refus, [...deja, libelle])
      }
      if (traduite.refus === 'categorie-indeduisible' && libelle !== '') {
        libellesIndeduisibles.push(libelle)
      }
      continue
    }
    charges.push(traduite.charge)
    rangements.push(`${traduite.categorie} · ${traduite.statut}`)
    if (traduite.tronquee) tronquees += 1
  }

  tableau('Catégories déduites du libellé — À VÉRIFIER :', compter(rangements))
  tableau('Pièces écartées avant l’envoi :', compter(refus))

  for (const [motif, libelles] of exemples) {
    console.log(`\n  Exemples — ${motif} :`)
    for (const libelle of libelles) console.log(`    · ${libelle}`)
  }

  // Ce que les exemples ne disent pas : QUELS mots manquent, et ce que chacun
  // coûte. Voir `motsDeTete`.
  const tete = motsDeTete(libellesIndeduisibles)
  if (tete.length > 0) {
    console.log(
      '\n  Premiers mots des libellés non reconnus — les ajouter à la table' +
        ' des catégories rapporterait, dans l’ordre :',
    )
    for (const { mot, nombre } of tete) {
      console.log(`    ${String(nombre).padStart(5)}  ${mot}`)
    }
  }
  if (tronquees > 0) {
    console.log(
      `\n  ${tronquees} titre(s) ou taille(s) tronqué(s) aux bornes du contrat.`,
    )
  }

  if (charges.length === 0) {
    console.log('\nRien à envoyer.')
    return
  }

  const lots = Math.ceil(charges.length / tailleLot)
  const secondes = Math.round(((lots - 1) * INTERVALLE_ENTRE_LOTS_MS) / 1000)
  console.log(
    `\n${charges.length} pièces à envoyer, par lots d’au plus ${tailleLot} ` +
      `(${lots} tour(s) si la boutique les traite entiers).` +
      (secondes > 0
        ? ` Cadence imposée par son débit : environ ${secondes} s d’attente cumulée.`
        : ''),
  )

  /**
   * Envoyées et visibles ne sont PAS le même nombre, et il faut le dire.
   *
   * Une pièce vendue ou retirée est envoyée en `ARCHIVED` : elle entre dans la
   * boutique et n'y paraît pas. Sur cet inventaire, les vendues sont la grande
   * majorité — annoncer « 811 pièces à envoyer » laissait donc attendre huit
   * cents vêtements en ligne, pour un catalogue dix fois plus petit.
   *
   * Le décompte par statut existait, dilué dans la table des catégories : il
   * fallait additionner une quinzaine de lignes de tête pour l'obtenir. On le
   * pose en clair, puisque c'est le seul chiffre qui répond à « combien de
   * vêtements verront mes clientes ».
   */
  const enLigne = rangements.filter((rang) => rang.endsWith('AVAILABLE')).length
  console.log(
    `  dont ${enLigne} en vente, visibles dans la boutique — ` +
      `${charges.length - enLigne} archivées (vendues ou retirées), envoyées mais non affichées.`,
  )

  const actions: string[] = []
  const motifs: string[] = []

  /**
   * Une FILE, et non un découpage figé.
   *
   * ---------------------------------------------------------------------------
   * Pourquoi la taille de lot n'est plus qu'un plafond
   * ---------------------------------------------------------------------------
   * La boutique s'arrête d'elle-même avant d'être tuée par son hébergeur, et
   * annonce combien de pièces du lot elle n'a pas regardées. Ce nombre dépend de
   * la latence entre elle et sa base — donc de la région, de la charge et du
   * moment. Il n'est pas devinable d'ici.
   *
   * Le découpage d'avant supposait l'inverse : une taille choisie à l'avance,
   * identique du premier lot au dernier. Quand elle était trop grande, la
   * fonction était tuée et l'appelant ne savait même pas ce qui était passé. On
   * relançait avec la moitié, et parfois il fallait recommencer.
   *
   * Ici, ce que la boutique n'a pas traité retourne en tête de file et repart au
   * tour suivant. Renvoyer une pièce est sans danger : elle se retrouve par son
   * `externalId` et se met à jour au lieu de se dupliquer.
   */
  let file = [...charges]
  let envoyees = 0
  let tour = 0

  while (file.length > 0) {
    tour += 1

    /**
     * Attendre AVANT le lot, sauf le premier.
     *
     * La boutique accorde trente appels par minute. Envoyés à la file, les
     * trente-troisièmes lots d'un import de huit cents pièces étaient refusés —
     * après que les trente premiers avaient déjà été écrits. Un import à moitié
     * fait, et un message qui parle de débit.
     *
     * On attend donc, plutôt que de demander à l'utilisateur de découper son
     * import à la main.
     */
    if (tour > 1) {
      await new Promise((resoudre) =>
        setTimeout(resoudre, INTERVALLE_ENTRE_LOTS_MS),
      )
    }

    const lot = file.slice(0, tailleLot)
    const { resultats, reportees } = await envoyer(
      boutique,
      syncCle,
      lot,
      essaiABlanc,
    )

    for (const resultat of resultats) {
      actions.push(resultat.action)
      if (resultat.reason) {
        motifs.push(`${resultat.reason} — ${resultat.detail ?? ''}`.trim())
      }
    }

    // Ce que la boutique a réellement traité, identifié par la réponse et non
    // par un décompte : les deux divergent dès qu'elle s'arrête en chemin.
    const traites = new Set(resultats.map((resultat) => resultat.externalId))
    const restants = lot.filter(
      (charge) => !traites.has(String(charge.externalId)),
    )

    /**
     * Aucune pièce traitée : on ne peut pas boucler indéfiniment.
     *
     * La boutique garantit d'en traiter au moins une par appel — elle n'applique
     * sa garde de temps qu'à partir de la deuxième. Zéro veut donc dire qu'autre
     * chose ne va pas, et réessayer à l'identique tournerait sans fin.
     */
    if (restants.length === lot.length) {
      console.error(
        `\nLa boutique n’a traité aucune des ${lot.length} pièces envoyées, sans refuser le lot.`,
      )
      console.error(
        'Arrêt : réessayer à l’identique tournerait sans fin. Regardez les journaux de la boutique dans Vercel, filtre « sync ».',
      )
      process.exit(1)
    }

    file = [...restants, ...file.slice(lot.length)]
    envoyees += lot.length - restants.length

    console.log(
      `  ${String(envoyees).padStart(5)}/${charges.length} pièces` +
        (reportees > 0
          ? ` — ${reportees} reportée(s) au tour suivant, la boutique a manqué de temps`
          : ''),
    )
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
