import type { Prisma, ArticleStatus } from '@prisma/client'

/**
 * Qui a le droit de voir quel article — un seul endroit.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier existe
 * ---------------------------------------------------------------------------
 * La règle était réécrite à la main à chaque requête. Elles avaient divergé :
 *
 *  - le catalogue exigeait `status IN (AVAILABLE, RESERVED)` ET une date de
 *    publication passée ;
 *  - la fiche article ajoutait SOLD, à raison ;
 *  - la page Favoris ne vérifiait QUE `publishedAt IS NOT NULL`. Une pièce
 *    retirée du registre (ARCHIVED) — abîmée, rendue, vendue ailleurs — y
 *    restait affichée avec son prix, cliquable, et menait à une page
 *    introuvable. Le prix d'un article qu'on ne peut plus acheter est une
 *    promesse qu'on ne tient pas ;
 *  - le compteur d'accueil oubliait la publication et pouvait donc annoncer
 *    des pièces que personne ne peut ouvrir — exactement le compteur mensonger
 *    que le brief interdit.
 *
 * Trois écritures d'une même règle, trois comportements. D'où un prédicat
 * unique, importé partout, y compris dans le SQL brut du catalogue.
 */

/**
 * Statuts listés dans une grille (catalogue, facettes, compteur d'inventaire).
 *
 * RESERVED est inclus : la réservation ne dure que quelques minutes et expire
 * le plus souvent. Masquer l'article ferait disparaître puis réapparaître des
 * pièces sans explication ; il est affiché avec une mention honnête.
 *
 * SOLD est exclu des grilles — une grille sert à choisir — mais reste visible
 * sur sa fiche.
 */
export const LISTED_STATUSES = [
  'AVAILABLE',
  'RESERVED',
] as const satisfies readonly ArticleStatus[]

/**
 * Statuts dont la page reste consultable.
 *
 * SOLD s'y ajoute : renvoyer 404 sur une pièce vendue détruirait le
 * référencement acquis, et le brief l'interdit explicitement. DRAFT,
 * SCHEDULED et ARCHIVED restent introuvables.
 */
export const VISIBLE_STATUSES = [
  ...LISTED_STATUSES,
  'SOLD',
] as const satisfies readonly ArticleStatus[]

/**
 * Clause Prisma : l'article est-il consultable ?
 *
 * `now` est un paramètre plutôt qu'un `new Date()` interne, pour que les tests
 * puissent se placer de part et d'autre d'une publication programmée.
 */
export function visibleArticleWhere(now = new Date()): Prisma.ArticleWhereInput {
  return {
    status: { in: [...VISIBLE_STATUSES] },
    publishedAt: { not: null, lte: now },
  }
}

/** Clause Prisma : l'article a-t-il sa place dans une grille ? */
export function listedArticleWhere(now = new Date()): Prisma.ArticleWhereInput {
  return {
    status: { in: [...LISTED_STATUSES] },
    publishedAt: { not: null, lte: now },
  }
}

/** Une ligne déjà chargée, vue par les prédicats ci-dessous. */
export interface ArticleVisibilityFacts {
  status: ArticleStatus
  publishedAt: Date | null
}

function matches(
  statuses: readonly ArticleStatus[],
  article: ArticleVisibilityFacts,
  now: Date,
): boolean {
  if (article.publishedAt === null) return false
  if (article.publishedAt > now) return false
  return statuses.includes(article.status)
}

/**
 * Mêmes règles que les clauses ci-dessus, appliquées à une ligne déjà chargée.
 *
 * Servent là où l'article vient d'ailleurs qu'une requête filtrée — un panier,
 * une reprise de favoris, un import de l'application d'inventaire.
 */
export function isArticleVisible(
  article: ArticleVisibilityFacts,
  now = new Date(),
): boolean {
  return matches(VISIBLE_STATUSES, article, now)
}

/** Consultable ET encore achetable : ni vendue, ni retirée. */
export function isArticleListed(
  article: ArticleVisibilityFacts,
  now = new Date(),
): boolean {
  return matches(LISTED_STATUSES, article, now)
}

/**
 * La réservation affichée est-elle encore réelle ?
 *
 * Le statut RESERVED ne redevient AVAILABLE qu'au passage du balayage — toutes
 * les cinq minutes, et seulement si la tâche planifiée est bien configurée.
 * S'en remettre au seul statut pour l'affichage avait deux conséquences :
 *
 *  - dans le meilleur des cas, la pastille « en cours d'achat » survivait
 *    quelques minutes à une réservation déjà éteinte ;
 *  - dans le pire, si la tâche ne tournait pas, une pièce restait marquée
 *    ainsi indéfiniment alors qu'elle était parfaitement achetable — un panier
 *    abandonné suffisait à la retirer de la vente aux yeux de tout le monde.
 *
 * L'échéance est donc lue directement. Le balayage redevient ce qu'il doit
 * être : un rangement, pas une condition de bon fonctionnement.
 */
export function isReservationLive(
  article: { status: ArticleStatus; reservedUntil: Date | null },
  now = new Date(),
): boolean {
  if (article.status !== 'RESERVED') return false
  if (article.reservedUntil === null) return false
  return article.reservedUntil > now
}
