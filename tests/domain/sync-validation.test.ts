import { describe, it, expect } from 'vitest'
import {
  MAX_BATCH_SIZE,
  detailForIssue,
  reasonForIssue,
  syncArticleSchema,
} from '@/lib/validation/sync'
import { buildArticleSlug, slugify } from '@/lib/sync/identifiers'

/**
 * Le contrat d'inventaire, vérifié sur sa forme.
 *
 * Ces tests ne touchent ni la base ni le réseau : ils portent sur ce que la
 * boutique ACCEPTE. C'est la première barrière, et la seule qui puisse être
 * exercée exhaustivement.
 */

const VALID = {
  externalId: 'abc-123',
  title: 'Chemise en coton',
  categorySlug: 'chemises',
  condition: 'VERY_GOOD',
  sizeLabel: 'L',
  priceCents: 3800,
  costCents: 900,
  weightGrams: 320,
  images: ['https://images.exemple.fr/1.jpg'],
} as const

function parse(patch: Record<string, unknown> = {}) {
  return syncArticleSchema.safeParse({ ...VALID, ...patch })
}

/** Motif de refus qu'aurait produit la route pour cette entrée. */
function reasonOf(patch: Record<string, unknown>): string {
  const result = parse(patch)
  expect(result.success, 'cette entrée aurait dû être refusée').toBe(false)

  const issue = result.error?.issues[0]
  expect(issue).toBeDefined()
  return issue ? reasonForIssue(issue) : 'aucun'
}

describe('article synchronisé — forme acceptée', () => {
  it('accepte le minimum obligatoire', () => {
    expect(parse().success).toBe(true)
  })

  it('accepte les champs facultatifs du contrat', () => {
    const result = parse({
      description: 'Coupe droite, épaules marquées.',
      brandName: 'Ralph Lauren',
      comparePriceCents: 4900,
      color: 'marine',
      material: 'coton',
      fit: 'droite',
      measurements: { chest: 54, length: 72 },
      status: 'ARCHIVED',
    })

    expect(result.success).toBe(true)
  })

  it('découpe les espaces autour des chaînes', () => {
    const result = parse({ externalId: '  abc-123  ', title: ' Chemise ' })
    expect(result.data?.externalId).toBe('abc-123')
    expect(result.data?.title).toBe('Chemise')
  })
})

describe('article synchronisé — ce qui est refusé', () => {
  it('refuse une clé inconnue plutôt que de l’ignorer', () => {
    // Le cas réel : `colour` au lieu de `color`. Un schéma permissif publierait
    // la pièce SANS sa couleur, et personne ne l'apprendrait.
    expect(parse({ colour: 'marine' }).success).toBe(false)
  })

  it('refuse les champs que l’application ne doit jamais envoyer', () => {
    for (const forbidden of ['slug', 'sku', 'floorPriceCents', 'priceSource']) {
      expect(parse({ [forbidden]: 'peu importe' }).success, forbidden).toBe(
        false,
      )
    }
  })

  it('refuse les statuts qui dépendent d’un paiement', () => {
    // Marquer vendue une pièce que personne n'a payée, ou réservée une pièce
    // qu'aucune caisse ne tient : les deux appartiennent à la boutique.
    expect(parse({ status: 'SOLD' }).success).toBe(false)
    expect(parse({ status: 'RESERVED' }).success).toBe(false)
  })

  it('refuse une couleur, une matière ou une coupe hors vocabulaire', () => {
    expect(reasonOf({ color: 'bleu-petrole' })).toBe('unknown-color')
    expect(reasonOf({ material: 'polyester' })).toBe('unknown-material')
    expect(reasonOf({ fit: 'cintree' })).toBe('unknown-fit')
  })

  it('refuse un prix nul, négatif ou décimal', () => {
    expect(reasonOf({ priceCents: 0 })).toBe('invalid-price')
    expect(reasonOf({ priceCents: -100 })).toBe('invalid-price')
    // 38,5 centimes n'existe pas : c'est un montant en euros envoyé par erreur.
    expect(reasonOf({ priceCents: 38.5 })).toBe('invalid-price')
    expect(reasonOf({ costCents: -1 })).toBe('invalid-price')
  })

  it('refuse un prix barré qui n’est pas strictement supérieur', () => {
    // Article L112-1-1 du code de la consommation : un prix de référence
    // fictif est une pratique commerciale trompeuse.
    expect(reasonOf({ comparePriceCents: 3800 })).toBe(
      'compare-price-not-higher',
    )
    expect(reasonOf({ comparePriceCents: 3000 })).toBe(
      'compare-price-not-higher',
    )
    expect(parse({ comparePriceCents: 3801 }).success).toBe(true)
  })

  it('refuse une image en clair ou sur une adresse IP littérale', () => {
    // Première barrière contre la SSRF : la seconde est la résolution DNS,
    // vérifiée dans tests/security/sync-images.test.ts.
    expect(parse({ images: ['http://images.exemple.fr/1.jpg'] }).success).toBe(
      false,
    )
    expect(parse({ images: ['https://169.254.169.254/latest'] }).success).toBe(
      false,
    )
    expect(parse({ images: ['https://[::1]/1.jpg'] }).success).toBe(false)
    expect(parse({ images: ['pas une url'] }).success).toBe(false)
  })

  it('accepte zéro image, et dix au plus', () => {
    const url = 'https://images.exemple.fr/x.jpg'

    // Zéro est permis DEPUIS que l'inventaire alimente la boutique : il ne
    // stocke aucune photo, et exiger un visuel revenait à refuser tout le stock.
    expect(parse({ images: [] }).success).toBe(true)

    // Absent vaut vide — `.default([])`. La suite du code compte les images sans
    // jamais avoir à distinguer les deux, qui n'ont ici aucune conséquence
    // différente.
    //
    // La clé est RETIRÉE, pas mise à `undefined` : `parse` part de `VALID`, qui
    // en contient une. Passer par `parse({})` testait le cas inverse de celui
    // qu'on croyait — c'est d'ailleurs comme ça que ce test a échoué d'abord.
    const { images: _images, ...sansImages } = VALID
    const absent = syncArticleSchema.safeParse(sansImages)
    expect(absent.success).toBe(true)
    if (absent.success) expect(absent.data.images).toEqual([])

    expect(parse({ images: Array(10).fill(url) }).success).toBe(true)
    expect(parse({ images: Array(11).fill(url) }).success).toBe(false)
  })

  it('accepte un poids absent — la catégorie en fournira un', () => {
    // Le repli est `Category.defaultWeightGrams`, résolu dans `lib/sync/articles`
    // et refusé (`missing-weight`) si la catégorie n'en a pas. Ce qui se joue
    // ici est seulement que le contrat laisse passer l'absence.
    const parsed = parse({ weightGrams: undefined })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.weightGrams).toBeUndefined()

    // Un poids PRÉSENT reste borné : zéro ou négatif n'est pas une absence.
    expect(parse({ weightGrams: 0 }).success).toBe(false)
    expect(parse({ weightGrams: -1 }).success).toBe(false)
  })

  it('refuse une mesure hors bornes physiques ou de clé inconnue', () => {
    // 380 cm de tour de poitrine, c'est presque toujours des millimètres.
    expect(parse({ measurements: { chest: 380 } }).success).toBe(false)
    expect(parse({ measurements: { chest: 0 } }).success).toBe(false)
    expect(parse({ measurements: { tourDeCou: 40 } }).success).toBe(false)
  })

  it('accepte un sous-ensemble de mesures, jamais les huit obligatoires', () => {
    // Un pantalon n'a pas d'épaules : exiger toutes les clés rendrait le champ
    // inutilisable.
    expect(parse({ measurements: { waist: 40 } }).success).toBe(true)
  })

  it('nomme le champ fautif dans le détail', () => {
    const result = parse({ color: 'bleu-petrole' })
    const issue = result.error?.issues[0]
    expect(issue && detailForIssue(issue)).toMatch(/^color : /)
  })

  it('retombe sur invalid-field pour ce qui n’a pas de motif dédié', () => {
    expect(reasonOf({ title: '' })).toBe('invalid-field')
    expect(reasonOf({ externalId: 'x'.repeat(65) })).toBe('invalid-field')
  })
})

describe('lot', () => {
  it('annonce la taille maximale du contrat', () => {
    expect(MAX_BATCH_SIZE).toBe(100)
  })
})

describe('adresse publique d’une pièce', () => {
  it('retire les diacritiques au lieu de les remplacer par un tiret', () => {
    expect(slugify('Écru élégant')).toBe('ecru-elegant')
    expect(slugify('W32 L34')).toBe('w32-l34')
  })

  it('ne laisse ni tiret en tête ni tiret en queue', () => {
    expect(slugify('  — Chemise —  ')).toBe('chemise')
  })

  it('termine par le numéro d’inventaire, ce qui la rend unique', () => {
    const first = buildArticleSlug({
      categorySlug: 'chemises',
      brandSlug: 'ralph-lauren',
      sizeLabel: 'L',
      sequence: 51,
    })
    const second = buildArticleSlug({
      categorySlug: 'chemises',
      brandSlug: 'ralph-lauren',
      sizeLabel: 'L',
      sequence: 52,
    })

    expect(first).toBe('chemises-ralph-lauren-l-51')
    expect(second).toBe('chemises-ralph-lauren-l-52')
  })

  it('se passe de marque sans laisser de double tiret', () => {
    expect(
      buildArticleSlug({
        categorySlug: 'chemises',
        brandSlug: null,
        sizeLabel: 'L',
        sequence: 7,
      }),
    ).toBe('chemises-l-7')
  })

  it('borne le corps sans laisser de tiret avant le numéro', () => {
    const slug = buildArticleSlug({
      categorySlug: 'maillots-de-bain',
      brandSlug: 'une-marque-au-nom-vraiment-tres-long-comme-il-en-existe',
      sizeLabel: 'XXL',
      sequence: 900,
    })

    expect(slug).not.toMatch(/--/)
    expect(slug.endsWith('-900')).toBe(true)
  })
})
