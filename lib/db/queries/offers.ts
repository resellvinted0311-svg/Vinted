import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import type { ArticleImageData } from '@/components/shop/article-image'
import { buyerMayAnswer, offerStanding, type OfferStanding } from '@/lib/domain/offers'

/**
 * Lecture des négociations, côté acheteuse.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la portée est le COMPTE, et lui seul
 * ---------------------------------------------------------------------------
 * Ailleurs — panier, favoris, suivi de commande — la portée accepte aussi le
 * jeton de session boutique, pour qu'on puisse acheter sans compte. Ici non, et
 * c'est une décision, pas un oubli.
 *
 * Une offre déposée sans compte s'apparie sur le jeton ET l'adresse e-mail
 * (`ownerWhere`, lib/shop/offers.ts). Une PAGE, elle, n'a que le jeton : elle
 * s'ouvre sans rien saisir. La lister sur ce seul critère afficherait, sur un
 * poste partagé, ce que la personne précédente a proposé et sur quoi — des
 * montants, des pièces, une histoire de négociation. Le suivi de commande
 * échappe à ce raisonnement parce que le numéro de commande y est saisi ; ici,
 * il n'y aurait rien à saisir.
 *
 * Une personne sans compte n'est pas laissée sans trace pour autant : l'accusé
 * de réception part par e-mail dans les trois cas, montant et échéance compris
 * (`submitOffer`). Et ce qu'elle a négocié la suit dans son compte si elle en
 * ouvre un — `adoptGuestSession` rattache ses offres, même jeton, même adresse.
 *
 * ---------------------------------------------------------------------------
 * Ce qui ne sort jamais
 * ---------------------------------------------------------------------------
 * `floorPriceCents` et `costCents` de la pièce : ce sont des données de
 * l'entreprise, et sur une page de négociation elles diraient à l'acheteuse
 * exactement jusqu'où descendre. `acceptedBelowFloor` non plus : c'est une note
 * interne sur une décision commerciale, qui ne regarde pas la personne à qui
 * l'on a fait une faveur.
 *
 * Comme partout, on énumère les colonnes voulues : une colonne privée ajoutée
 * demain au schéma ne peut pas fuiter par omission.
 */

/**
 * Exporté pour être VÉRIFIÉ, pas pour être réutilisé.
 *
 * `tests/security/private-fields.test.ts` le balaie à la recherche des colonnes
 * privées, comme il le fait des sélecteurs publics du catalogue. Sans cet
 * export, ajouter demain `floorPriceCents: true` pour dépanner un affichage ne
 * ferait échouer aucun test tant qu'on n'exécute pas la base.
 */
export const offerRegisterSelect = {
  id: true,
  amountCents: true,
  status: true,
  expiresAt: true,
  priceValidUntil: true,
  respondedAt: true,
  createdAt: true,
  // Non nul = cette ligne est une contre-proposition de la boutique, pas une
  // offre de l'acheteuse. Les deux portent la même identité — il faut bien
  // qu'elle puisse voir ce qu'on lui a répondu — et rien d'autre ne les
  // distingue.
  parentOfferId: true,
  article: {
    select: {
      slug: true,
      sku: true,
      priceCents: true,
      status: true,
      translations: { select: { locale: true, title: true } },
      images: {
        // Les dimensions accompagnent l'URL : c'est ce qui réserve le ratio
        // avant chargement, et donc ce qui empêche la liste de sauter sous le
        // curseur pendant que les vignettes arrivent.
        select: { url: true, alt: true, blurhash: true, width: true, height: true },
        orderBy: { position: 'asc' },
        take: 1,
      },
    },
  },
  // Volontairement absents : acceptedBelowFloor, rejectionReason,
  // counterAmountCents, guestEmail, guestSessionToken, userId, et du côté de la
  // pièce costCents, floorPriceCents, minOfferCents, internalNotes.
} satisfies Prisma.OfferSelect

type OfferRegisterRow = Prisma.OfferGetPayload<{
  select: typeof offerRegisterSelect
}>

export interface OfferRegisterEntry {
  id: string
  amountCents: number
  /** Dérivé à l'instant de la lecture. Voir `offerStanding`. */
  standing: OfferStanding
  /** Vrai quand la boutique a proposé ce montant, et non l'acheteuse. */
  fromShop: boolean
  /**
   * L'acheteuse peut-elle accepter ou décliner cette ligne MAINTENANT ?
   *
   * Dérivé serveur par `buyerMayAnswer`, jamais recalculé dans la vue : c'est
   * la même règle qui décide d'afficher un bouton et d'accepter le geste, et la
   * dupliquer les ferait diverger — un bouton qui échoue, ou un geste possible
   * que rien ne propose.
   */
  canAnswer: boolean
  expiresAt: Date
  priceValidUntil: Date | null
  createdAt: Date
  article: {
    slug: string
    sku: string
    title: string
    priceCents: number
    isSold: boolean
    image: ArticleImageData | null
  }
}

/**
 * Le titre de la pièce dans la langue lue, français à défaut.
 *
 * Une pièce importée le matin même peut n'avoir aucune traduction : on retombe
 * alors sur la référence d'inventaire, qui est toujours là. Afficher une ligne
 * sans titre du tout ferait perdre à l'acheteuse la seule chose qui lui permet
 * de reconnaître ce qu'elle a négocié.
 */
function titleFor(
  translations: readonly { locale: string; title: string }[],
  locale: string,
  fallback: string,
): string {
  return (
    translations.find((row) => row.locale === locale)?.title ??
    translations.find((row) => row.locale === 'fr')?.title ??
    fallback
  )
}

function toEntry(row: OfferRegisterRow, locale: string, now: Date): OfferRegisterEntry {
  const image = row.article.images[0] ?? null

  return {
    id: row.id,
    amountCents: row.amountCents,
    standing: offerStanding(row, now),
    fromShop: row.parentOfferId !== null,
    canAnswer: buyerMayAnswer(row, now),
    expiresAt: row.expiresAt,
    priceValidUntil: row.priceValidUntil,
    createdAt: row.createdAt,
    article: {
      slug: row.article.slug,
      sku: row.article.sku,
      title: titleFor(row.article.translations, locale, row.article.sku),
      priceCents: row.article.priceCents,
      isSold: row.article.status === 'SOLD',
      image,
    },
  }
}

/**
 * Les négociations d'un compte, la plus récente d'abord.
 *
 * L'ordre est chronologique et non « ce qui appelle un geste d'abord » : la
 * page remonte elle-même les échéances en tête (`offerNeedsAttention`), et une
 * liste dont l'ordre change tout seul entre deux visites est illisible.
 *
 * `take` est appliqué en base : une personne qui négocie beaucoup ne doit pas
 * faire ramener trois cents lignes et leurs images pour en afficher cinquante.
 */
export async function listOffers(
  userId: string,
  locale: string,
  { limit = 50, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<OfferRegisterEntry[]> {
  // Une chaîne vide n'est pas un compte : la laisser passer ferait
  // correspondre toute offre dont `userId` vaudrait lui aussi la chaîne vide.
  // On n'écrit jamais cette valeur, mais la portée d'une lecture ne doit pas
  // dépendre d'une convention d'écriture qui pourrait changer.
  if (!userId) return []

  const rows = await prisma.offer.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: offerRegisterSelect,
  })

  return rows.map((row) => toEntry(row, locale, now))
}
