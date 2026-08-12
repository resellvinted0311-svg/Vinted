import type { Prisma } from '@prisma/client'

/**
 * Champs qui ne doivent JAMAIS traverser la frontière serveur → client.
 *
 * Cette liste est la source de vérité du test de fuite de données
 * (tests/security/no-private-field-leak.test.ts) : toute réponse publique est
 * balayée récursivement à la recherche de ces clés.
 */
export const PRIVATE_ARTICLE_FIELDS = [
  'costCents',
  'floorPriceCents',
  'internalNotes',
  'sourcedFrom',
  'sourcedAt',
] as const

export const PRIVATE_ORDER_ITEM_FIELDS = ['costCentsSnapshot'] as const

/**
 * Sélecteurs publics.
 *
 * On énumère les colonnes voulues plutôt que d'exclure les colonnes privées :
 * ajouter demain un champ privé au schéma ne peut donc pas le faire fuiter par
 * omission. C'est plus verbeux, c'est le but.
 */

export const publicArticleImageSelect = {
  id: true,
  url: true,
  blurhash: true,
  width: true,
  height: true,
  position: true,
  alt: true,
} satisfies Prisma.ArticleImageSelect

export const publicArticleTranslationSelect = {
  locale: true,
  title: true,
  description: true,
  isMachineTranslated: true,
} satisfies Prisma.ArticleTranslationSelect

export const publicBrandSelect = {
  id: true,
  slug: true,
  name: true,
  logoUrl: true,
  isLuxury: true,
} satisfies Prisma.BrandSelect

export const publicCategorySelect = {
  id: true,
  slug: true,
  parentId: true,
  measurementKeys: true,
  translations: { select: { locale: true, name: true } },
} satisfies Prisma.CategorySelect

/** Vignette de catalogue : le strict nécessaire pour afficher une grille. */
export const publicArticleCardSelect = {
  id: true,
  sku: true,
  slug: true,
  condition: true,
  sizeLabel: true,
  sizeNormalized: true,
  color: true,
  priceCents: true,
  comparePriceCents: true,
  status: true,
  publishedAt: true,
  soldAt: true,
  allowOffers: true,
  offersOpenAt: true,
  brand: { select: publicBrandSelect },
  category: { select: { id: true, slug: true } },
  images: {
    select: publicArticleImageSelect,
    orderBy: { position: 'asc' },
    take: 2,
  },
  translations: { select: publicArticleTranslationSelect },
} satisfies Prisma.ArticleSelect

/** Fiche article complète. Toujours sans coût d'achat ni plancher. */
export const publicArticleDetailSelect = {
  id: true,
  sku: true,
  slug: true,
  condition: true,
  sizeLabel: true,
  sizeNormalized: true,
  color: true,
  material: true,
  fit: true,
  priceCents: true,
  comparePriceCents: true,
  weightGrams: true,
  status: true,
  publishedAt: true,
  soldAt: true,
  viewCount: true,
  allowOffers: true,
  offersOpenAt: true,
  lastPriceDropAt: true,
  brand: { select: publicBrandSelect },
  category: { select: publicCategorySelect },
  images: {
    select: publicArticleImageSelect,
    orderBy: { position: 'asc' },
  },
  measurements: { select: { key: true, valueCm: true } },
  translations: { select: publicArticleTranslationSelect },
} satisfies Prisma.ArticleSelect

export type PublicArticleCard = Prisma.ArticleGetPayload<{
  select: typeof publicArticleCardSelect
}>

export type PublicArticleDetail = Prisma.ArticleGetPayload<{
  select: typeof publicArticleDetailSelect
}>

/**
 * Filet de sécurité à l'exécution, en plus des sélecteurs.
 *
 * Utilisé par les tests et par les Route Handlers publics : si un champ privé
 * apparaît dans une charge utile, on veut le savoir bruyamment, pas le
 * découvrir dans une réponse en production.
 */
export function findPrivateFieldLeaks(payload: unknown): string[] {
  const forbidden = new Set<string>([
    ...PRIVATE_ARTICLE_FIELDS,
    ...PRIVATE_ORDER_ITEM_FIELDS,
    'passwordHash',
  ])
  const found = new Set<string>()
  const seen = new WeakSet<object>()

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      node.forEach((child, i) => {
        walk(child, `${path}[${i}]`)
      })
      return
    }

    for (const [key, value] of Object.entries(node)) {
      if (forbidden.has(key)) {
        found.add(path ? `${path}.${key}` : key)
      }
      walk(value, path ? `${path}.${key}` : key)
    }
  }

  walk(payload, '')
  return [...found]
}
