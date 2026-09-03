import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Aucun lien écrit en dur ne doit mener à une route inexistante.
 *
 * ---------------------------------------------------------------------------
 * Les cinq défauts que ce test a attrapés
 * ---------------------------------------------------------------------------
 * Le colophon annonçait « Contact » vers `/contact` depuis le premier jour :
 * la route n'a jamais existé. Le lien était rendu sur TOUTES les pages du
 * site, dans les huit langues.
 *
 * L'espace personnel faisait pire : sur ses huit rubriques, quatre —
 * `/compte/messages`, `/compte/retours`, `/compte/alertes` et
 * `/compte/parametres` — n'avaient pas davantage de route. La moitié d'un menu
 * en 404, sur le premier écran que voit quelqu'un qui vient de se connecter.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce test est statique, et non un parcours de navigateur
 * ---------------------------------------------------------------------------
 * Un test de bout en bout ne voit que les liens des pages qu'il visite, et
 * seulement dans l'état où il les visite : l'espace personnel exige une
 * session, la fiche article un article en stock, le suivi de commande un
 * numéro. Un lien mort dans une branche non parcourue reste invisible.
 *
 * Ici, on lit le CODE : tout littéral `href` qui commence par une barre
 * oblique est confronté à l'arborescence réelle des routes. Aucune session,
 * aucune base de données, aucun navigateur — donc rien qui puisse rendre le
 * garde-fou silencieux. Et il tourne dans la suite rapide, ce qui compte tant
 * qu'aucune intégration continue ne lance les tests de navigateur.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce test ne couvre pas, et l'assume
 * ---------------------------------------------------------------------------
 * Les adresses composées à l'exécution — `` `/a/${article.slug}` `` — ne sont
 * pas des littéraux : elles sont hors de portée par construction. Elles sont
 * en revanche couvertes par les tests de navigateur, qui suivent réellement
 * ces liens depuis une grille remplie.
 */

const RACINE = process.cwd()

// ---------------------------------------------------------------------------
// Les routes qui existent
// ---------------------------------------------------------------------------

/**
 * Traduit l'arborescence `app/` en motifs de chemins.
 *
 * Le préfixe de langue est retiré : `Link` de next-intl prend des chemins SANS
 * langue et l'ajoute lui-même. Les groupes de routes — `(shop)` — sont retirés
 * eux aussi : ils organisent les fichiers et les gabarits, ils n'apparaissent
 * jamais dans une URL.
 */
function collecterRoutes(): string[][] {
  const base = join(RACINE, 'app', '[locale]')
  const motifs: string[][] = []

  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree)
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin)
      } else if (entree === 'page.tsx') {
        const segments = relative(base, dossier)
          .split(/[\\/]/)
          .filter((segment) => segment.length > 0)
          // `(shop)` et consorts : groupes de routes, invisibles dans l'URL.
          .filter((segment) => !/^\(.*\)$/.test(segment))
        motifs.push(segments)
      }
    }
  }

  parcourir(base)
  return motifs
}

const ROUTES = collecterRoutes()

/** Un segment `[slug]` accepte n'importe quelle valeur ; `[...slug]` en accepte plusieurs. */
function correspond(segments: string[], motif: string[]): boolean {
  let i = 0
  for (let j = 0; j < motif.length; j += 1) {
    const attendu = motif[j] as string

    if (attendu.startsWith('[...') || attendu.startsWith('[[...')) {
      // Segment attrape-tout : il consomme tout ce qui reste, et il en faut
      // au moins un (la forme optionnelle `[[...x]]` n'est pas utilisée ici).
      return segments.length - i >= 1 && j === motif.length - 1
    }

    if (i >= segments.length) return false
    if (attendu.startsWith('[')) {
      i += 1
      continue
    }
    if (attendu !== segments[i]) return false
    i += 1
  }

  return i === segments.length
}

function routeExiste(chemin: string): boolean {
  const segments = (chemin.split('?')[0] as string)
    .split('#')[0]!
    .split('/')
    .filter((segment) => segment.length > 0)

  // La racine du site : `app/[locale]/(shop)/page.tsx`.
  if (segments.length === 0) return ROUTES.some((motif) => motif.length === 0)

  return ROUTES.some((motif) => correspond(segments, motif))
}

// ---------------------------------------------------------------------------
// Les liens écrits dans le code
// ---------------------------------------------------------------------------

const DOSSIERS_SOURCES = ['app', 'components', 'lib'] as const

/**
 * `href: '/…'` (objets de configuration) et `href="/…"` (JSX).
 *
 * Les gabarits en accent grave sont volontairement exclus : leur valeur n'est
 * connue qu'à l'exécution.
 */
const LIENS = /href\s*[:=]\s*(?:\{\s*)?['"](\/[^'"]*)['"]/g

interface Lien {
  chemin: string
  fichier: string
}

function collecterLiens(): Lien[] {
  const liens: Lien[] = []

  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      if (entree === 'node_modules' || entree.startsWith('.')) continue
      const chemin = join(dossier, entree)

      if (statSync(chemin).isDirectory()) {
        parcourir(chemin)
        continue
      }
      if (!/\.tsx?$/.test(entree)) continue

      const source = readFileSync(chemin, 'utf8')
      for (const trouve of source.matchAll(LIENS)) {
        liens.push({
          chemin: trouve[1] as string,
          fichier: relative(RACINE, chemin),
        })
      }
    }
  }

  for (const dossier of DOSSIERS_SOURCES) parcourir(join(RACINE, dossier))
  return liens
}

/**
 * Chemins qui ne désignent pas une page.
 *
 * `/api/…` et `/placeholder/…` sont des gestionnaires de route ; `/fr/…` porte
 * déjà sa langue parce qu'il sert d'action à un formulaire HTML pur, que
 * next-intl ne réécrit pas.
 */
const HORS_PORTEE = [/^\/api\//, /^\/placeholder\//, /^\/(fr|en|es|it|nl|de|pt|pl)\//]

describe('liens internes', () => {
  const liens = collecterLiens().filter(
    (lien) => !HORS_PORTEE.some((motif) => motif.test(lien.chemin)),
  )

  it('trouve bien les liens et les routes — sinon le test ne prouve rien', () => {
    // Un test qui parcourt zéro fichier passe toujours. On vérifie donc
    // d'abord qu'il a réellement lu quelque chose, et qu'il connaît des
    // routes bien identifiées.
    expect(liens.length).toBeGreaterThan(10)
    expect(ROUTES.length).toBeGreaterThan(10)
    expect(liens.map((lien) => lien.chemin)).toContain('/catalogue')
  })

  it('ne pointe vers aucune route inexistante', () => {
    const morts = liens
      .filter((lien) => !routeExiste(lien.chemin))
      .map((lien) => `${lien.chemin} — ${lien.fichier}`)

    expect(morts, 'liens vers des routes qui n’existent pas').toEqual([])
  })

  it('reconnaît un segment dynamique et refuse un chemin inventé', () => {
    // Garde-fou du garde-fou : si `correspond` acceptait tout, le test
    // précédent passerait quoi qu'il arrive.
    expect(routeExiste('/a/veste-en-laine')).toBe(true)
    expect(routeExiste('/c/femme/robes')).toBe(true)
    expect(routeExiste('/pages/contact')).toBe(true)
    expect(routeExiste('/')).toBe(true)

    expect(routeExiste('/contact')).toBe(false)
    expect(routeExiste('/compte/alertes')).toBe(false)
    expect(routeExiste('/catalogue/inexistant')).toBe(false)
  })
})
