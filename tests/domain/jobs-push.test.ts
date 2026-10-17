import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Le poussage des travaux après la réponse, et sa seule vraie exigence :
 * NE JAMAIS FAIRE ÉCHOUER CE QUI L'APPELLE.
 *
 * ---------------------------------------------------------------------------
 * Le défaut dont ce fichier est la cicatrice
 * ---------------------------------------------------------------------------
 * Cette fonction est appelée depuis le webhook de paiement, juste après qu'une
 * vente a été enregistrée. Une exception à cet endroit transformerait une
 * vente réussie en réponse 500 — et Stripe rejouerait l'événement, encore et
 * encore, sur une commande déjà payée.
 *
 * Ce n'est pas une crainte abstraite : `revalidatePath` a produit exactement ce
 * défaut sur ce même chemin, en levant « Invariant: static generation store
 * missing » hors contexte de requête. La correction fut la même — envelopper —
 * et c'est ce fichier qui la tient fermée pour `after`.
 *
 * Les tests tournent HORS contexte de requête, ce qui est précisément la
 * situation où `after` lève. Autrement dit : ils reproduisent le défaut par
 * construction, sans avoir à le simuler.
 */

// Typée avec son paramètre : sans cela, `mockImplementation` reçoit une
// signature sans argument et le fichier ne compile plus dès qu'un test lit
// l'identifiant du travail.
const runJobNow = vi.hoisted(() =>
  vi.fn(async (_id: string): Promise<boolean> => true),
)

vi.mock('@/lib/jobs/worker', () => ({ runJobNow }))

const { pousserApresReponse } = await import('@/lib/jobs/push')

beforeEach(() => {
  runJobNow.mockClear()
})

describe('hors contexte de requête', () => {
  it('ne lève PAS, alors que « after » lève', async () => {
    /*
      Le cas réel : un script de maintenance, un test, le cron lui-même. Si
      cette fonction propageait, une vente enregistrée finirait en 500 et
      Stripe rejouerait l'événement sur une commande déjà payée.

      Ce qu'on perd en échange est ce qu'on avait avant : l'e-mail attend le
      prochain passage du cron. Le travail reste inscrit, et c'est la file qui
      fait foi.
    */
    expect(() => pousserApresReponse(['job-1', 'job-2'])).not.toThrow()
  })

  it('n’appelle rien pour une liste vide, et ne lève pas non plus', () => {
    // Le cas d'une transition qui n'envoie aucun e-mail — mise en préparation,
    // constat de livraison. Entrer dans `after` pour ne rien faire tiendrait
    // la fonction serverless en vie sans raison.
    expect(() => pousserApresReponse([])).not.toThrow()
    expect(runJobNow).not.toHaveBeenCalled()
  })
})

describe('ce qui est poussé quand « after » fonctionne', () => {
  it('exécute chaque travail, dans l’ordre, un seul à la fois', async () => {
    /*
      `after` est remplacé par une exécution immédiate : on teste NOTRE
      rappel, pas l'ordonnanceur de Next.

      L'ordre et la sérialisation comptent. Les travaux poussés ensemble sont
      presque toujours deux e-mails du même geste — la confirmation à
      l'acheteuse puis l'avis à la boutique. Les lancer de front doublerait la
      pointe d'appels chez le prestataire d'envoi pour gagner quelques
      centaines de millisecondes sur un travail que plus personne n'attend.
    */
    vi.resetModules()

    const rappels: (() => Promise<void>)[] = []
    vi.doMock('next/server', () => ({
      after: (rappel: () => Promise<void>) => rappels.push(rappel),
    }))

    const { pousserApresReponse: pousser } = await import('@/lib/jobs/push')

    const ordre: string[] = []
    runJobNow.mockImplementation(async (id: string) => {
      ordre.push(`début:${id}`)
      await Promise.resolve()
      ordre.push(`fin:${id}`)
      return true
    })

    pousser(['job-a', 'job-b'])

    expect(rappels).toHaveLength(1)
    await rappels[0]!()

    expect(ordre).toEqual([
      'début:job-a',
      'fin:job-a',
      'début:job-b',
      'fin:job-b',
    ])

    vi.doUnmock('next/server')
    vi.resetModules()
  })

  it('poursuit la liste même si « runJobNow » échoue', async () => {
    /*
      `runJobNow` promet de ne pas lever, mais cette promesse est tenue par un
      autre fichier. Si elle était rompue un jour, le second e-mail ne doit pas
      disparaître avec le premier — et surtout, l'exception ne doit pas
      remonter dans un `unhandledRejection`, qui tue le processus sur certaines
      plateformes et avec lui les requêtes des autres visiteurs.
    */
    vi.resetModules()

    const rappels: (() => Promise<void>)[] = []
    vi.doMock('next/server', () => ({
      after: (rappel: () => Promise<void>) => rappels.push(rappel),
    }))

    const { pousserApresReponse: pousser } = await import('@/lib/jobs/push')

    const tentes: string[] = []
    runJobNow.mockImplementation(async (id: string) => {
      tentes.push(id)
      if (id === 'job-a') throw new Error('prestataire injoignable')
      return true
    })

    pousser(['job-a', 'job-b'])

    await expect(rappels[0]!()).resolves.toBeUndefined()

    // Les DEUX ont été tentés. Sans enveloppe par travail, `job-b` n'aurait
    // jamais été appelé : la boutique ne serait pas prévenue d'une vente parce
    // que la confirmation à l'acheteuse a échoué.
    expect(tentes).toEqual(['job-a', 'job-b'])

    vi.doUnmock('next/server')
    vi.resetModules()
  })
})
