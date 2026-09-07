import 'server-only'

import { cache } from 'react'
import { prisma } from '@/lib/db/client'

/**
 * Catégories et marques.
 *
 * Le libellé est résolu dans la langue demandée, avec repli sur le français :
 * une traduction manquante ne doit jamais produire une entrée de menu vide.
 */

export interface CategoryNode {
  id: string
  slug: string
  name: string
  position: number
  children: CategoryNode[]
}

/**
 * Toute la taxonomie, en UNE requête, mutualisée sur la durée d'un rendu.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle remplace
 * ---------------------------------------------------------------------------
 * Chaque fonction de ce fichier interrogeait la base pour son compte, et deux
 * d'entre elles remontaient l'arbre UN NIVEAU À LA FOIS : une requête pour la
 * catégorie, une pour son parent, une pour le parent du parent. Sur une page
 * de rayon, la taxonomie coûtait à elle seule quatre allers-retours ; sur une
 * fiche article, cinq — le fil d'Ariane refaisant le même trajet que la page.
 *
 * C'est le coût qui grandit le plus mal : il suit la PROFONDEUR de l'arbre.
 * Ajouter un niveau de rangement ajouterait une requête à chaque page, sans
 * que rien ne l'annonce.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi tout charger est ici moins cher que cibler
 * ---------------------------------------------------------------------------
 * La taxonomie d'une friperie tient en quelques dizaines de lignes — dix-huit
 * aujourd'hui. Les rapatrier toutes coûte une requête et quelques kilo-octets,
 * là où les cibler en coûte une par niveau et par appelant. Le calcul
 * s'inverserait sur un arbre de plusieurs milliers d'entrées ; il ne s'en
 * approche pas.
 *
 * `cache` de React mutualise l'appel sur la DURÉE D'UN RENDU : la vitrine, le
 * fil d'Ariane et le résolveur de chemin peuvent la demander chacun leur tour,
 * la base n'est interrogée qu'une fois. Ce n'est pas un cache entre requêtes —
 * une catégorie renommée est visible au rendu suivant.
 */
const chargerTaxonomie = cache(async () => {
  const rows = await prisma.category.findMany({
    orderBy: { position: 'asc' },
    select: {
      id: true,
      slug: true,
      parentId: true,
      position: true,
      _count: { select: { children: true } },
      translations: {
        select: {
          locale: true,
          name: true,
          seoTitle: true,
          seoDescription: true,
          editorialBody: true,
        },
      },
    },
  })

  return { rows, parId: new Map(rows.map((row) => [row.id, row])) }
})

type LigneTaxonomie = Awaited<ReturnType<typeof chargerTaxonomie>>['rows'][number]

/**
 * Le chemin d'une catégorie, de la racine jusqu'à elle.
 *
 * La remontée est BORNÉE par le nombre de lignes : une donnée cyclique — un
 * parent qui serait son propre descendant — ferait sinon tourner cette boucle
 * indéfiniment et figerait le rendu de la page, sans la moindre erreur.
 */
function remonter(
  ligne: LigneTaxonomie,
  parId: Map<string, LigneTaxonomie>,
  total: number,
): LigneTaxonomie[] {
  const chemin: LigneTaxonomie[] = []
  let courant: LigneTaxonomie | undefined = ligne
  let garde = total + 1

  while (courant && garde > 0) {
    chemin.unshift(courant)
    courant = courant.parentId ? parId.get(courant.parentId) : undefined
    garde -= 1
  }

  return chemin
}

function nameFor(
  translations: { locale: string; name: string }[],
  locale: string,
  fallback: string,
): string {
  return (
    translations.find((t) => t.locale === locale)?.name ??
    translations.find((t) => t.locale === 'fr')?.name ??
    fallback
  )
}

export async function getCategoryTree(locale: string): Promise<CategoryNode[]> {
  const { rows } = await chargerTaxonomie()

  const nodes = new Map<string, CategoryNode>()
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: nameFor(row.translations, locale, row.slug),
      position: row.position,
      children: [],
    })
  }

  const roots: CategoryNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)
    if (!node) continue

    if (row.parentId) {
      nodes.get(row.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/** Une entrée de rayon, telle que les cartes de vitrine l'affichent. */
export interface ShowcaseCategory {
  slug: string
  name: string
  /**
   * Chemin COMPLET depuis la racine, `['hauts', 't-shirts']`.
   *
   * Il ne double pas `slug` : c'est la seule des deux valeurs avec laquelle on
   * puisse composer un lien. La route `/c/[...slug]` vérifie que le chemin
   * annoncé correspond à la hiérarchie réelle et renvoie 404 sinon — une
   * garde légitime, qui empêche deux adresses de servir la même page.
   *
   * Les cartes de rayon composaient leur lien avec le seul `slug`. Sur les
   * feuilles de premier niveau — Robes, Sacs, Chaussures — le chemin se
   * trouvait être identique et tout fonctionnait ; sur toutes les autres,
   * la carte menait à un 404. Huit rayons sur quinze, dont Jeans, T-shirts
   * et Pulls, c'est-à-dire précisément ceux qu'on ouvre en premier.
   *
   * `slug` reste exposé parce qu'il sert de CLÉ — les photographies de rayon
   * sont indexées par lui. Les deux valeurs ont donc chacune leur emploi, et
   * les confondre est exactement ce qui a produit le défaut.
   */
  path: string[]
}

/**
 * Les rayons de la boutique, pour les cartes de vitrine.
 *
 * ---------------------------------------------------------------------------
 * Cette liste vient de l'ARBRE, jamais des facettes — et c'est tout l'enjeu
 * ---------------------------------------------------------------------------
 * Les cartes de sous-catégorie se construisaient sur `getFacets`, c'est-à-dire
 * sur les pièces réellement en vente. Conséquence : un rayon sans pièce
 * n'avait pas de carte, et une boutique dont rien n'est encore rangé n'avait
 * AUCUNE carte — la page s'affichait vide, sans erreur, et la mise en page
 * demandée restait invisible.
 *
 * Or ces cartes ne sont pas un compte rendu du stock : ce sont les rayons du
 * magasin. Un rayon existe parce qu'il est prévu, pas parce qu'il est plein,
 * exactement comme un panneau « Chaussures » reste accroché quand l'étagère
 * est vide. La liste est donc celle de la taxonomie, et elle est stable.
 *
 * ---------------------------------------------------------------------------
 * Seules les FEUILLES sont rendues
 * ---------------------------------------------------------------------------
 * « Hauts » et « Bas » sont des regroupements qui portent des enfants ; les
 * proposer à côté de leurs propres enfants donnerait deux chemins vers le même
 * contenu et une carte « Hauts » juste avant une carte « T-shirts » qu'elle
 * contient. On garde donc les rayons où l'on range vraiment quelque chose.
 */
export async function listShowcaseCategories(
  locale: string,
): Promise<ShowcaseCategory[]> {
  const { rows, parId } = await chargerTaxonomie()

  return rows
    .filter((row) => row._count.children === 0)
    .map((row) => ({
      slug: row.slug,
      name: nameFor(row.translations, locale, row.slug),
      path: remonter(row, parId, rows.length).map((etape) => etape.slug),
    }))
}

export interface CategoryDetail {
  id: string
  slug: string
  name: string
  seoTitle: string | null
  seoDescription: string | null
  editorialBody: string | null
  /** Fil d'Ariane, de la racine jusqu'à la catégorie courante. */
  ancestors: { slug: string; name: string }[]
}

/**
 * Résout une catégorie depuis un chemin `/c/hauts/chemises`.
 *
 * Seul le dernier segment identifie la catégorie ; les précédents servent au
 * fil d'Ariane et sont vérifiés pour éviter qu'un chemin incohérent réponde
 * en 200 (contenu dupliqué).
 */
export async function getCategoryByPath(
  segments: string[],
  locale: string,
): Promise<CategoryDetail | null> {
  const slug = segments.at(-1)
  if (!slug) return null

  const { rows, parId } = await chargerTaxonomie()
  const category = rows.find((row) => row.slug === slug)
  if (!category) return null

  const chemin = remonter(category, parId, rows.length)
  const ancestors = chemin.slice(0, -1).map((etape) => ({
    slug: etape.slug,
    name: nameFor(etape.translations, locale, etape.slug),
  }))

  // Le chemin annoncé doit correspondre à la hiérarchie réelle. C'est cette
  // garde qui interdit deux adresses pour une même page — et c'est elle que
  // les cartes de rayon violaient en ne posant que le slug de la feuille.
  if (segments.join('/') !== chemin.map((etape) => etape.slug).join('/')) {
    return null
  }

  const translation =
    category.translations.find((t) => t.locale === locale) ??
    category.translations.find((t) => t.locale === 'fr')

  return {
    id: category.id,
    slug: category.slug,
    name: translation?.name ?? category.slug,
    seoTitle: translation?.seoTitle ?? null,
    seoDescription: translation?.seoDescription ?? null,
    editorialBody: translation?.editorialBody ?? null,
    ancestors,
  }
}

/** Chemin complet d'une catégorie, pour construire ses liens. */
export async function getCategoryPath(slug: string): Promise<string[]> {
  const { rows, parId } = await chargerTaxonomie()
  const ligne = rows.find((row) => row.slug === slug)
  if (!ligne) return []

  return remonter(ligne, parId, rows.length).map((etape) => etape.slug)
}

export interface BrandSummary {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  isLuxury: boolean
  articleCount: number
}

/** Marques ayant au moins un article en ligne. */
export async function listBrandsWithCounts(): Promise<BrandSummary[]> {
  const brands = await prisma.brand.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      isLuxury: true,
      _count: {
        select: {
          articles: {
            where: {
              status: { in: ['AVAILABLE', 'RESERVED'] },
              publishedAt: { not: null, lte: new Date() },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return brands
    .map((brand) => ({
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      logoUrl: brand.logoUrl,
      isLuxury: brand.isLuxury,
      articleCount: brand._count.articles,
    }))
    .filter((brand) => brand.articleCount > 0)
}

export interface CategoryEntry {
  id: string
  /** Chemin complet, prêt à composer une URL `/c/…`. */
  path: string
  name: string
  articleCount: number
}

/**
 * Catégories terminales et leur nombre de pièces en ligne.
 *
 * Seules les feuilles sont retenues — une pièce est toujours rangée dans une
 * feuille, un parent n'apporterait qu'un doublon.
 *
 * SANS APPELANT pour l'instant, et c'est assumé : l'accueil les présentait en
 * index typographique, cette section a été retirée. La fonction reste parce
 * que la place des catégories sur l'accueil est en cours d'arbitrage — la
 * supprimer pour la réécrire à l'identique dans quelques jours serait du
 * mouvement, pas du ménage. Si l'arbitrage conclut autrement, elle part.
 */
export async function listCategoriesWithCounts(
  locale: string,
): Promise<CategoryEntry[]> {
  const rows = await prisma.category.findMany({
    select: {
      id: true,
      slug: true,
      parentId: true,
      position: true,
      translations: { select: { locale: true, name: true } },
      parent: { select: { slug: true } },
      _count: {
        select: {
          articles: {
            where: {
              status: { in: ['AVAILABLE', 'RESERVED'] },
              publishedAt: { not: null, lte: new Date() },
            },
          },
        },
      },
    },
    orderBy: { position: 'asc' },
  })

  return rows
    .filter((row) => row._count.articles > 0)
    .map((row) => ({
      id: row.id,
      path: row.parent ? `${row.parent.slug}/${row.slug}` : row.slug,
      name: nameFor(row.translations, locale, row.slug),
      articleCount: row._count.articles,
    }))
    // Les plus fournies d'abord : l'index sert à entrer dans le catalogue,
    // pas à réciter l'arborescence.
    .sort((a, b) => b.articleCount - a.articleCount)
}

/**
 * Mutualisée sur la durée d'un rendu, pour la même raison que la fiche
 * article : `generateMetadata` et le composant de page demandent tous deux la
 * marque, et sans enveloppe la lecture part deux fois.
 */
export const getBrandBySlug = cache(async function getBrandBySlug(slug: string) {
  return prisma.brand.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, logoUrl: true, isLuxury: true },
  })
})
