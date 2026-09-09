import { describe, it, expect, vi, beforeEach } from 'vitest'
import { locales } from '@/lib/i18n/routing'

/**
 * La purge du cache, et surtout ce qu'elle ne doit JAMAIS faire.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier garde fermé
 * ---------------------------------------------------------------------------
 * `revalidatePath` lit un contexte que Next attache à la requête en cours, et
 * il LÈVE quand ce contexte manque. La première version de ce module appelait
 * la purge sans filet depuis le webhook de paiement : la vente s'écrivait, la
 * purge levait, le webhook répondait 500, et Stripe rejouait un événement déjà
 * traité. La boutique avait encaissé une vente que son propre journal
 * signalait comme ratée.
 *
 * Le renversement est le point : une COMMODITÉ — servir une page fraîche une
 * minute plus tôt — était devenue capable de faire échouer la vente elle-même.
 * C'est ce que le premier bloc ci-dessous interdit.
 */

const revalidatePath = vi.fn()

vi.mock('next/cache', () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}))

const findMany = vi.fn()

vi.mock('@/lib/db/client', () => ({
  prisma: { article: { findMany: (args: unknown) => findMany(args) } },
}))

const {
  invaliderVitrine,
  invaliderFiches,
  invaliderReglages,
  MAX_FICHES_INVALIDEES,
} = await import('@/lib/cache/invalidation')

beforeEach(() => {
  revalidatePath.mockReset()
  findMany.mockReset()
})

/** Les chemins réellement demandés à Next pendant l'appel. */
function chemins(): string[] {
  return revalidatePath.mock.calls.map((appel) => String(appel[0]))
}

describe('une purge qui échoue n’emporte pas ce qui l’a demandée', () => {
  it('n’expose jamais l’exception de `revalidatePath`', () => {
    revalidatePath.mockImplementation(() => {
      throw new Error('Invariant: static generation store missing')
    })

    // Le geste attendu : ça ne lève pas. Si un jour ça lève, une vente
    // encaissée redeviendra un 500 côté Stripe.
    expect(() => invaliderFiches(['une-veste'])).not.toThrow()
  })

  it('continue les chemins suivants après un échec', () => {
    // Un seul chemin en échec ne doit pas priver les sept autres langues de
    // leur purge : l'échec de `revalidatePath` est par chemin, pas global.
    let appels = 0
    revalidatePath.mockImplementation(() => {
      appels += 1
      if (appels === 1) throw new Error('un seul chemin fâché')
    })

    invaliderVitrine()

    expect(appels).toBe(locales.length * 2 + 1)
  })
})

describe('les chemins purgés', () => {
  it('sont les trois pages en cache, dans les huit langues, plus le plan de site', () => {
    /*
      La liste est une MESURE, pas une supposition : relevé sur une
      construction de production, seules `/{langue}`, `/{langue}/marques`,
      `/{langue}/a/{slug}` et `/sitemap.xml` portent un en-tête de cache.
    */
    invaliderFiches(['une-veste'])

    const attendus = [
      ...locales.map((l) => `/${l}`),
      ...locales.map((l) => `/${l}/marques`),
      '/sitemap.xml',
      ...locales.map((l) => `/${l}/a/une-veste`),
    ]

    expect(chemins().sort()).toEqual(attendus.sort())
  })

  it('n’incluent AUCUNE page rendue à chaque requête', () => {
    /*
      Le catalogue, les rayons, les pages de marque et les deux univers lisent
      `searchParams` : ils répondent `no-store` et ne sont jamais mis en cache.
      Les purger se lirait comme une protection et n'en serait pas une — c'est
      le piège dans lequel `audiencePathsToRevalidate()` est tombé.
    */
    invaliderFiches(['une-veste'])

    const dynamiques = chemins().filter((chemin) =>
      /\/(catalogue|femme|homme|c\/|marque\/)/.test(chemin),
    )

    expect(dynamiques).toEqual([])
  })

  it('ne purgent JAMAIS la mise en page racine', () => {
    // `revalidatePath('/', 'layout')` efface les pages prérendues du site
    // entier. Un test de sécurité l'interdit déjà à la lecture du code ; ici on
    // vérifie le comportement.
    invaliderFiches(['une-veste', 'un-pull'])

    expect(chemins()).not.toContain('/')
    for (const appel of revalidatePath.mock.calls) {
      expect(appel).toHaveLength(1)
    }
  })

  it('ne purgent la vitrine qu’une fois, quel que soit le nombre de pièces', () => {
    // La vitrine ne dépend d'aucune pièce en particulier : la purger vingt
    // fois n'a pas plus d'effet que de la purger une, et chaque appel coûte.
    invaliderFiches(['a', 'b', 'c', 'd'])

    expect(chemins().filter((chemin) => chemin === '/fr')).toHaveLength(1)
    expect(
      chemins().filter((chemin) => chemin === '/sitemap.xml'),
    ).toHaveLength(1)
  })

  it('dédoublonnent les slugs', () => {
    invaliderFiches(['une-veste', 'une-veste'])

    expect(chemins().filter((c) => c === '/fr/a/une-veste')).toHaveLength(1)
  })
})

describe('le plafond', () => {
  it('renonce aux fiches au-delà de la borne, et garde la vitrine', () => {
    /*
      Une passe de baisse automatique n'est pas bornée en nombre de pièces.
      Au-delà du plafond, on purge la vitrine et on laisse les fiches à leur
      échéance — c'est-à-dire le comportement d'avant ce module, donc un repli
      sûr. Ce qui compte est que ce renoncement ne soit pas SILENCIEUX : le
      journal porte `cache.invalidation_plafonnee`.
    */
    const trop = Array.from(
      { length: MAX_FICHES_INVALIDEES + 1 },
      (_, index) => `piece-${index}`,
    )

    expect(invaliderFiches(trop)).toBe(0)
    expect(chemins().some((chemin) => chemin.includes('/a/'))).toBe(false)
    expect(chemins()).toContain('/fr')
  })

  it('traite le lot quand il tient exactement dans la borne', () => {
    const juste = Array.from(
      { length: MAX_FICHES_INVALIDEES },
      (_, index) => `piece-${index}`,
    )

    expect(invaliderFiches(juste)).toBe(MAX_FICHES_INVALIDEES)
  })
})

describe('les réglages', () => {
  it('purgent les CGV — la page la plus figée du site', () => {
    /*
      `app/[locale]/(shop)/pages/[slug]` porte `generateStaticParams` et AUCUN
      `revalidate` : elle est statique jusqu'au prochain déploiement. Trois
      délais contractuels y sont pourtant lus en base. Sans cette purge,
      changer un délai depuis la régie laissait le site publier l'ancien,
      indéfiniment — une clause de vente qui ne correspond plus à ce que la
      boutique applique.
    */
    invaliderReglages(['offerResponseHours'])

    expect(chemins()).toEqual(locales.map((l) => `/${l}/pages/cgv`))
  })

  it('purgent l’accueil quand un visuel change', () => {
    invaliderReglages(['homeHeroImageUrl'])

    expect(chemins()).toEqual(locales.map((l) => `/${l}`))
  })

  it('ne purgent RIEN pour un réglage qui ne s’affiche nulle part', () => {
    // La marge minimale, les frais de paiement, la majoration de port : aucun
    // ne paraît sur une page en cache. Les traiter comme les autres ferait
    // passer un ajustement de marge pour un changement de vitrine.
    invaliderReglages(['minMarginCents', 'stripePercentBps'])

    expect(chemins()).toEqual([])
  })
})
