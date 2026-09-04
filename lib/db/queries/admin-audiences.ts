import 'server-only'

import type { ArticleStatus } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { routing } from '@/lib/i18n/routing'
import { listedArticleWhere } from '@/lib/db/visibility'

/**
 * Les pièces qui n'ont pas encore d'univers, vues depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet écran a dû exister
 * ---------------------------------------------------------------------------
 * La vitrine porte deux cartes, Femme et Homme, et chaque univers ouvre une
 * grille de sous-catégories. Ni les unes ni les autres ne s'affichent tant
 * qu'aucune pièce ne porte `audience` : `UniverseCards` se retire dès qu'un
 * des deux univers est vide, et la grille de sous-catégories se construit sur
 * les facettes, donc sur zéro ligne.
 *
 * Or la colonne vient d'être créée, et RIEN ne la remplit :
 *
 *  - la synchronisation ne l'écrit pas, délibérément — `attributeFields`
 *    l'omet, sans quoi l'empreinte de synchronisation changerait sur chaque
 *    pièce et le prochain passage réécrirait tous les prix ;
 *  - le formulaire de pièce la propose, mais il ne s'ouvre que sur les pièces
 *    NÉES ICI (`externalId IS NULL`) ;
 *  - le stock réel vient presque entièrement de l'application de gestion.
 *
 * Autrement dit, avant cet écran, il n'existait aucun chemin — aucun — pour
 * qualifier une pièce importée. La fonctionnalité était complète côté public
 * et injoignable côté régie : le site restait exactement tel qu'avant.
 *
 * ---------------------------------------------------------------------------
 * Ces requêtes ignorent DÉLIBÉRÉMENT `externalId`, contrairement à
 * `admin-articles.ts`
 * ---------------------------------------------------------------------------
 * L'autre module écarte les pièces importées, et sa raison est bonne : « le
 * prochain import écraserait le travail sans un mot ». Elle ne s'applique pas
 * ici, et il faut dire pourquoi plutôt que de recopier l'exception.
 *
 * `audience` n'appartient pas au contrat de synchronisation. Elle n'est ni
 * lue, ni écrite, ni même regardée par `lib/sync/articles.ts` : les champs
 * réécrits à chaque passage sont énumérés un par un dans `attributeFields`, et
 * celle-ci n'y figure pas. Un import ne peut donc pas l'effacer.
 *
 * C'est ce qui rend l'exception sûre — et c'est aussi ce qui la rend fragile :
 * le jour où quelqu'un ajoutera `audience` à `attributeFields`, ce travail de
 * qualification sera perdu au passage suivant. Un test le garde.
 *
 * ---------------------------------------------------------------------------
 * Seules les pièces EN GRILLE sont proposées, par défaut
 * ---------------------------------------------------------------------------
 * Qualifier un brouillon ou une pièce retirée ne change rien à ce que le
 * public voit : les facettes ne comptent que `LISTED_STATUSES`, publication
 * passée. Mettre les mille pièces du registre dans la même liste noierait les
 * quelques centaines qui, elles, feraient apparaître les cartes.
 *
 * La boutiquière peut demander le reste — `inclureHorsGrille` — pour préparer
 * un brouillon avant sa mise en vente.
 */

export interface UnqualifiedArticleRow {
  id: string
  sku: string
  title: string
  status: ArticleStatus
  categoryName: string
  /** Vignette, ou `null` : une pièce sans photo se qualifie quand même. */
  thumbnailUrl: string | null
  /** Vient-elle de l'application de gestion ? Affiché, jamais bloquant. */
  imported: boolean
}

export interface UnqualifiedCategory {
  id: string
  name: string
  count: number
}

/** Le filtre commun aux trois requêtes : sans univers, et rien d'autre. */
function sansUnivers(inclureHorsGrille: boolean, now: Date) {
  return {
    audience: null,
    ...(inclureHorsGrille ? {} : listedArticleWhere(now)),
  }
}

export interface UnqualifiedQuery {
  locale: string
  /** Restreint à une catégorie. Absent : toutes. */
  categoryId?: string | undefined
  inclureHorsGrille?: boolean
  limit?: number
  now?: Date
}

/**
 * Les pièces à qualifier, les plus récemment publiées en tête.
 *
 * Le plafond est haut mais réel : la page rend autant de cases à cocher, et
 * une liste sans borne finirait par produire un formulaire de plusieurs
 * mégaoctets sur un registre de plusieurs milliers de pièces.
 */
export async function listUnqualifiedArticles({
  locale,
  categoryId,
  inclureHorsGrille = false,
  limit = 120,
  now = new Date(),
}: UnqualifiedQuery): Promise<UnqualifiedArticleRow[]> {
  const rows = await prisma.article.findMany({
    where: {
      ...sansUnivers(inclureHorsGrille, now),
      ...(categoryId ? { categoryId } : {}),
    },
    // `publishedAt` d'abord : on qualifie en priorité ce qui est déjà en
    // vitrine. `id` en second départage — sans lui, deux pièces publiées à la
    // même seconde peuvent changer d'ordre entre deux chargements, et une case
    // cochée se retrouverait en face d'une autre pièce après un rechargement.
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      sku: true,
      status: true,
      externalId: true,
      images: {
        orderBy: { position: 'asc' },
        take: 1,
        select: { url: true },
      },
      category: {
        select: {
          slug: true,
          translations: {
            where: { locale: { in: [locale, routing.defaultLocale] } },
            select: { locale: true, name: true },
          },
        },
      },
      translations: {
        // Repli sur la langue source : une pièce dont la traduction manque
        // sortirait de la liste avec une jointure stricte, et deviendrait
        // impossible à qualifier.
        where: { locale: { in: [locale, routing.defaultLocale] } },
        select: { locale: true, title: true },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    title:
      row.translations.find((t) => t.locale === locale)?.title ??
      row.translations[0]?.title ??
      row.sku,
    status: row.status,
    categoryName:
      row.category.translations.find((t) => t.locale === locale)?.name ??
      row.category.translations[0]?.name ??
      row.category.slug,
    thumbnailUrl: row.images[0]?.url ?? null,
    imported: row.externalId !== null,
  }))
}

/** Combien de pièces attendent encore un univers. */
export async function countUnqualified(
  inclureHorsGrille = false,
  now = new Date(),
): Promise<number> {
  return prisma.article.count({ where: sansUnivers(inclureHorsGrille, now) })
}

/**
 * Les catégories où il reste à qualifier, avec leur reste à faire.
 *
 * Sert le filtre de l'écran. C'est lui qui rend le travail tenable : une
 * catégorie homogène — « Robes », « Jupes » — se traite en une fois, et les
 * catégories mixtes se font pièce par pièce sans être noyées dedans.
 *
 * Les catégories à zéro n'apparaissent pas : ce sont celles qui sont FAITES.
 */
export async function listCategoriesWithUnqualified(
  locale: string,
  inclureHorsGrille = false,
  now = new Date(),
): Promise<UnqualifiedCategory[]> {
  const groups = await prisma.article.groupBy({
    by: ['categoryId'],
    where: sansUnivers(inclureHorsGrille, now),
    _count: { _all: true },
  })

  if (groups.length === 0) return []

  const categories = await prisma.category.findMany({
    where: { id: { in: groups.map((g) => g.categoryId) } },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      slug: true,
      translations: {
        where: { locale: { in: [locale, routing.defaultLocale] } },
        select: { locale: true, name: true },
      },
    },
  })

  const countById = new Map(groups.map((g) => [g.categoryId, g._count._all]))

  return categories.map((category) => ({
    id: category.id,
    name:
      category.translations.find((t) => t.locale === locale)?.name ??
      category.translations[0]?.name ??
      category.slug,
    count: countById.get(category.id) ?? 0,
  }))
}
