import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

/**
 * Une pièce qui LÈVE ne doit pas emporter le passage entier.
 *
 * ---------------------------------------------------------------------------
 * Le défaut, tel qu'il s'est produit
 * ---------------------------------------------------------------------------
 * `lib/sync/pull.ts` annonce qu'« une pièce rejetée n'annule pas les autres ».
 * C'était vrai des refus de VALIDATION, qui reviennent en résultat — et faux de
 * tout le reste : une exception traversait la boucle, le passage ne rendait
 * aucun compte, et l'écran affichait « la synchronisation a échoué » sur un
 * import qui venait pourtant d'en écrire des dizaines.
 *
 * Le cas le plus probable n'a rien d'exotique : deux passages qui se
 * chevauchent voient tous deux une pièce absente et la créent tous deux ; le
 * second se heurte à l'unicité de `externalId`.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un fichier à part, et pourquoi `syncArticle` est simulé
 * ---------------------------------------------------------------------------
 * On veut exercer la BOUCLE face à une pièce qui lève. Provoquer une vraie
 * exception depuis les données demanderait de fabriquer une course entre deux
 * écritures concurrentes — long, et instable. On simule donc la seule fonction
 * dont on veut forcer l'échec, et rien d'autre : `loadSyncContext` et
 * `resteAssezDeTemps` restent les vraies.
 *
 * La simulation étant hissée en tête de fichier par Vitest, elle vivrait sinon
 * dans TOUS les tests du module — d'où ce fichier séparé.
 */

const PREFIX = 'pull-resilience-'
const WORKSPACE = 'atelier-de-resilience'

vi.mock('@/lib/sync/articles', async (importOriginal) => {
  const vrai =
    await importOriginal<typeof import('@/lib/sync/articles')>()

  return {
    ...vrai,
    syncArticle: vi.fn(async (article: unknown, index: number) => {
      const externalId = String((article as { externalId: string }).externalId)

      // La deuxième pièce lève, comme le ferait une écriture concurrente.
      if (externalId.endsWith('-2')) {
        throw new Error('violation d’unicité simulée sur externalId')
      }

      return {
        externalId,
        action: index >= 0 ? ('created' as const) : ('created' as const),
      }
    }),
  }
})

const { pullInventaire } = await import('@/lib/sync/pull')
const { prisma } = await import('@/lib/db/client')

function ligne(index: number) {
  return {
    id: `${PREFIX}${index}`,
    article: `Chemise en lin ${index}`,
    marque: 'Uniqlo',
    taille: 'M',
    etat: 'Très bon état',
    couleur: 'Bleu ciel',
    description: null,
    prix_achat: '1.50',
    prix_annonce: '14.90',
    prix_vendu: null,
    en_vente: 'Oui',
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (entree: unknown) => {
    const url = new URL(String(entree))
    const decalage = Number(url.searchParams.get('offset') ?? '0')
    const lignes = [ligne(1), ligne(2), ligne(3)]

    return new Response(
      JSON.stringify(decalage === 0 ? lignes : []),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })

  vi.stubEnv('APP_SUPABASE_URL', 'https://inventaire.test')
  vi.stubEnv('APP_SUPABASE_SERVICE_KEY', 'cle-de-service-de-test')
  vi.stubEnv('APP_WORKSPACE_ID', WORKSPACE)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await prisma.$disconnect()
})

describe('une pièce qui lève', () => {
  it('n’empêche pas les autres d’être écrites', async () => {
    const rapport = await pullInventaire({ budgetMs: 20_000 })

    // Le passage rend son compte, au lieu de disparaître en exception.
    expect(rapport.creees).toBe(2)
    expect(rapport.echouees).toBe(1)
  })

  it('est COMPTÉE, et non passée sous silence', async () => {
    // Un import à trous ne doit pas ressembler à un import réussi : le compte
    // est remonté jusqu'à l'écran, où une pièce en échec se voit.
    const rapport = await pullInventaire({ budgetMs: 20_000 })
    expect(rapport.echouees).toBeGreaterThan(0)
  })

  it('ne revient PAS dans le reste à examiner', async () => {
    /**
     * Elle a été vue. La recompter dans `reste` ferait boucler l'écran sur
     * elle indéfiniment : chaque passage la reprendrait, échouerait, et
     * annoncerait qu'il en reste toujours autant.
     */
    const rapport = await pullInventaire({ budgetMs: 20_000 })
    expect(rapport.reste).toBe(0)
  })
})
