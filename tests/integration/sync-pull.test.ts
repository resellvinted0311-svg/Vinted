import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

import { prisma } from '@/lib/db/client'
import { pullInventaire, PullNotConfiguredError } from '@/lib/sync/pull'

/**
 * La boutique va chercher l'inventaire dans l'application de gestion.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce lot devait rendre vrai
 * ---------------------------------------------------------------------------
 * La synchronisation réclamait un terminal et cinq variables d'environnement
 * rechargées à chaque fois. Ce n'était pas une manipulation pénible, c'était
 * une manipulation qu'on ne fait pas — donc une boutique qui ne se synchronise
 * jamais.
 *
 * Ce module la fait tourner seule. Trois choses doivent alors être vraies, et
 * aucune n'est visible depuis `syncArticle` :
 *
 *  - un passage BORNÉ dans le temps rend la main plutôt que de se faire tuer,
 *    et dit ce qu'il n'a pas regardé ;
 *  - les passages successifs COUVRENT tout le stock, au lieu de reprendre
 *    éternellement les mêmes premières pièces ;
 *  - une configuration absente se lit comme telle, et non comme une panne.
 */

const PREFIX = 'pull-test-'
const WORKSPACE = 'atelier-de-test'

/** Une ligne d'inventaire, dans la forme que rend PostgREST. */
function ligne(index: number, patch: Record<string, unknown> = {}) {
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
    ...patch,
  }
}

/**
 * L'inventaire de l'application, simulé au niveau du RÉSEAU.
 *
 * On remplace `fetch`, et non le module de lecture : c'est ce qui fait porter
 * au test la construction de l'URL, le filtre sur l'espace de travail et la
 * pagination. Simuler plus haut laisserait ces trois-là sans preuve — or le
 * filtre sur l'espace de travail est précisément ce qui empêche d'importer le
 * stock des autres.
 */
function servirInventaire(lignes: Record<string, unknown>[]): {
  urls: string[]
} {
  const urls: string[] = []

  vi.stubGlobal('fetch', async (entree: unknown) => {
    const url = new URL(String(entree))
    urls.push(url.toString())

    const decalage = Number(url.searchParams.get('offset') ?? '0')
    const page = url.searchParams.get('workspace_id') === `eq.${WORKSPACE}`
      ? lignes.slice(decalage, decalage + 1000)
      : []

    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  return { urls }
}

async function nettoyer(): Promise<void> {
  await prisma.article.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  })
}

beforeEach(async () => {
  await nettoyer()
  vi.unstubAllGlobals()
  vi.stubEnv('APP_SUPABASE_URL', 'https://inventaire.test')
  vi.stubEnv('APP_SUPABASE_SERVICE_KEY', 'cle-de-service-de-test')
  vi.stubEnv('APP_WORKSPACE_ID', WORKSPACE)
})

afterAll(async () => {
  await nettoyer()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await prisma.$disconnect()
})

describe('la configuration', () => {
  it('nomme TOUTES les variables absentes, pas la première', async () => {
    // Elles s'ajoutent en une fois et manquent donc en une fois. Signaler la
    // première obligerait à un aller-retour par variable, chacun payé d'un
    // passage de tâche planifiée — soit une journée.
    vi.stubEnv('APP_SUPABASE_URL', '')
    vi.stubEnv('APP_SUPABASE_SERVICE_KEY', '')

    const erreur = await pullInventaire({ budgetMs: 5_000 }).catch(
      (error: unknown) => error,
    )

    expect(erreur).toBeInstanceOf(PullNotConfiguredError)
    expect((erreur as PullNotConfiguredError).manquantes).toEqual([
      'APP_SUPABASE_URL',
      'APP_SUPABASE_SERVICE_KEY',
    ])
  })
})

describe('un passage', () => {
  it('ne lit QUE l’espace de travail configuré', async () => {
    /**
     * La base de l'application est multi-locataire. Sans ce filtre, un passage
     * importerait le stock de dizaines d'autres personnes dans une boutique
     * publique — et le responsable de traitement, au sens du RGPD, serait la
     * boutiquière.
     */
    const { urls } = servirInventaire([ligne(1)])

    await pullInventaire({ budgetMs: 20_000 })

    expect(urls).not.toHaveLength(0)
    for (const url of urls) {
      expect(url).toContain(`workspace_id=eq.${WORKSPACE}`)
    }
  })

  it('crée les pièces, et les compte', async () => {
    servirInventaire([ligne(2), ligne(3)])

    const rapport = await pullInventaire({ budgetMs: 20_000 })

    expect(rapport.lues).toBe(2)
    expect(rapport.creees).toBe(2)
    expect(rapport.reste).toBe(0)

    const enBase = await prisma.article.count({
      where: { externalId: { startsWith: PREFIX } },
    })
    expect(enBase).toBe(2)
  })

  it('compte à part ce que la traduction ÉCARTE', async () => {
    // Un libellé dont on ne peut pas déduire le vêtement n'est pas un échec de
    // synchronisation : c'est une donnée que la boutique refuse de deviner,
    // parce que la catégorie décide du poids, donc du port réellement payé.
    servirInventaire([ligne(4), ligne(5, { article: 'Lot vintage' })])

    const rapport = await pullInventaire({ budgetMs: 20_000 })

    expect(rapport.lues).toBe(2)
    expect(rapport.ecartees).toBe(1)
    expect(rapport.creees).toBe(1)
  })

  it('ne réécrit RIEN au passage suivant', async () => {
    // C'est ce qui rend une cadence quotidienne soutenable : un passage sans
    // changement lit les pièces et s'arrête là.
    servirInventaire([ligne(6), ligne(7)])

    await pullInventaire({ budgetMs: 20_000 })
    const second = await pullInventaire({ budgetMs: 20_000 })

    expect(second.inchangees).toBe(2)
    expect(second.creees).toBe(0)
    expect(second.misesAJour).toBe(0)
  })
})

describe('un passage trop court', () => {
  /**
   * Une horloge qu'on contrôle, plutôt que le temps réel.
   *
   * Le comportement dépend de la durée d'une pièce, qui varie avec la latence
   * de la base : un test qui s'appuierait dessus passerait ou non selon la
   * machine. On injecte donc le temps.
   */
  function horlogeQuiSaute(sautMs: number): () => number {
    let appels = 0
    return () => {
      appels += 1
      // Les deux premiers appels bornent la première pièce ; ensuite le temps a
      // bondi, et plus rien ne tient dans le budget.
      return appels <= 2 ? 0 : sautMs
    }
  }

  it('s’arrête de lui-même et DIT ce qu’il n’a pas regardé', async () => {
    servirInventaire([ligne(10), ligne(11), ligne(12)])

    const rapport = await pullInventaire({
      budgetMs: 10_000,
      maintenant: horlogeQuiSaute(60_000),
    })

    // Une pièce au moins : un passage doit toujours avancer, sinon les suivants
    // reprendraient éternellement le même point de départ.
    expect(rapport.examinees).toBe(1)
    expect(rapport.reste).toBe(2)
  })

  it('reprend là où il s’est arrêté, jusqu’à tout couvrir', async () => {
    /**
     * Le défaut que l'ordre de passage empêche.
     *
     * Sans tri par ancienneté de synchronisation, chaque passage borné
     * reprendrait les mêmes premières pièces et les dernières ne seraient
     * JAMAIS vues. L'inventaire paraîtrait synchronisé — aucune erreur nulle
     * part — alors qu'une part n'aurait jamais été touchée.
     */
    const lignes = [ligne(20), ligne(21), ligne(22)]
    servirInventaire(lignes)

    for (let passage = 0; passage < 3; passage += 1) {
      await pullInventaire({
        budgetMs: 10_000,
        maintenant: horlogeQuiSaute(60_000),
      })
    }

    const enBase = await prisma.article.findMany({
      where: { externalId: { startsWith: `${PREFIX}2` } },
      select: { externalId: true },
    })
    expect(enBase.map((row) => row.externalId).sort()).toEqual([
      `${PREFIX}20`,
      `${PREFIX}21`,
      `${PREFIX}22`,
    ])
  })
})

describe('ce que l’écran reçoit quand la configuration manque', () => {
  it('porte les NOMS des absentes, pas un message figé', async () => {
    /**
     * Le message nommait les trois variables, quelle que soit celle qui
     * manquait. On relisait les trois, on en trouvait deux correctes, et on
     * cherchait ailleurs — un diagnostic qui ne distingue pas ne diagnostique
     * rien.
     *
     * Le test porte sur ce que l'erreur EXPOSE, puisque c'est cela que l'écran
     * affiche.
     */
    vi.stubEnv('APP_WORKSPACE_ID', '')

    const erreur = await pullInventaire({ budgetMs: 5_000 }).catch(
      (error: unknown) => error,
    )

    expect(erreur).toBeInstanceOf(PullNotConfiguredError)
    const manquantes = (erreur as PullNotConfiguredError).manquantes

    // Une seule : les deux autres sont posées, et les nommer enverrait les
    // vérifier pour rien.
    expect(manquantes).toEqual(['APP_WORKSPACE_ID'])
  })

  it('ne divulgue AUCUNE valeur, seulement des noms', async () => {
    // Ces variables sont des clés d'accès. Le nom suffit à savoir quoi poser ;
    // la valeur n'a rien à faire dans un message d'écran ni dans un journal.
    vi.stubEnv('APP_SUPABASE_SERVICE_KEY', '')

    const erreur = (await pullInventaire({ budgetMs: 5_000 }).catch(
      (error: unknown) => error,
    )) as PullNotConfiguredError

    expect(erreur.message).not.toContain('cle-de-service-de-test')
    expect(erreur.message).not.toContain(WORKSPACE)
  })
})
