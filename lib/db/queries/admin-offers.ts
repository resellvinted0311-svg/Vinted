import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { isBelowFloor } from '@/lib/domain/offers'

/**
 * Les offres à trancher, vues du côté de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Ici, les champs privés SORTENT — et c'est le seul endroit du projet
 * ---------------------------------------------------------------------------
 * `floorPriceCents` et `costCents` ne quittent jamais une réponse publique :
 * c'est la règle du cahier des charges, et `lib/db/selectors.ts` en tient la
 * liste. Cette requête-là est l'exception, et elle n'en est pas vraiment une —
 * ce sont les données de l'entreprise, rendues à l'entreprise.
 *
 * Ce qui rend l'exception sûre n'est pas ce module mais ses appelants : la
 * seule page qui l'appelle vit sous `app/[locale]/admin/`, où chaque fichier
 * appelle `requireAdmin()`, et un test parcourt l'arborescence pour le vérifier
 * (`tests/security/middleware-scope.test.ts`).
 *
 * Ce que l'admin doit voir pour décider, et qu'il ne peut pas deviner :
 * le prix plancher, sous lequel la vente est déficitaire port et prélèvements
 * compris ; le coût d'achat, qui dit ce que la pièce a réellement coûté ; et
 * l'écart entre l'offre reçue et ce plancher, calculé ici plutôt que de tête.
 *
 * ---------------------------------------------------------------------------
 * L'ordre : ce qui expire en premier passe devant
 * ---------------------------------------------------------------------------
 * Une offre sans réponse s'éteint d'elle-même au bout du délai réglé. Trier par
 * date de dépôt décroissante — le réflexe — mettrait en tête celles qui ont le
 * plus de temps devant elles, et laisserait mourir les autres en bas de page.
 */

const pendingOfferSelect = {
  id: true,
  amountCents: true,
  createdAt: true,
  expiresAt: true,
  // Non nul = contre-proposition de la boutique, en attente d'une réponse de
  // l'ACHETEUSE. Elle n'a rien à faire dans la file du vendeur : c'est lui qui
  // l'a émise.
  parentOfferId: true,
  guestEmail: true,
  user: { select: { email: true, firstName: true } },
  article: {
    select: {
      id: true,
      slug: true,
      sku: true,
      priceCents: true,
      status: true,
      // Les trois champs qui n'existent que pour cette page.
      floorPriceCents: true,
      costCents: true,
      minOfferCents: true,
      translations: { select: { locale: true, title: true } },
      images: {
        select: { url: true, alt: true, blurhash: true, width: true, height: true },
        orderBy: { position: 'asc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.OfferSelect

type PendingOfferRow = Prisma.OfferGetPayload<{ select: typeof pendingOfferSelect }>

export interface AdminOfferEntry {
  id: string
  amountCents: number
  createdAt: Date
  expiresAt: Date
  /** Vrai quand le délai de réponse est écoulé mais que le balayage n'est pas passé. */
  lapsed: boolean
  /**
   * Qui a proposé. Affichée pour reconnaître un client fidèle d'un premier
   * contact — jamais transmise ailleurs.
   */
  from: string
  article: {
    slug: string
    sku: string
    title: string
    priceCents: number
    floorPriceCents: number
    costCents: number
    minOfferCents: number | null
    isSold: boolean
    image: { url: string; alt: string | null; blurhash: string | null; width: number; height: number } | null
  }
  /** L'offre passe-t-elle sous le prix plancher ? Décidé serveur, jamais de tête. */
  belowFloor: boolean
  /** Écart au plancher, en centimes. Négatif quand l'offre est dessous. */
  marginToFloorCents: number
}

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

function toEntry(row: PendingOfferRow, locale: string, now: Date): AdminOfferEntry {
  const image = row.article.images[0] ?? null

  return {
    id: row.id,
    amountCents: row.amountCents,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lapsed: row.expiresAt <= now,
    from: row.user?.email ?? row.guestEmail ?? '—',
    article: {
      slug: row.article.slug,
      sku: row.article.sku,
      title: titleFor(row.article.translations, locale, row.article.sku),
      priceCents: row.article.priceCents,
      floorPriceCents: row.article.floorPriceCents,
      costCents: row.article.costCents,
      minOfferCents: row.article.minOfferCents,
      isSold: row.article.status === 'SOLD',
      image,
    },
    belowFloor: isBelowFloor(row.amountCents, row.article.floorPriceCents),
    marginToFloorCents: row.amountCents - row.article.floorPriceCents,
  }
}

/**
 * Les offres qui attendent une décision du vendeur.
 *
 * Les contre-propositions déjà émises sont ÉCARTÉES (`parentOfferId: null`) :
 * elles portent le même statut `PENDING`, mais c'est l'acheteuse qui doit y
 * répondre. Les laisser dans cette liste ferait croire au vendeur qu'il a
 * quelque chose à faire de sa propre proposition.
 *
 * Les offres échues restent affichées, marquées : le balayage ne passe que
 * toutes les cinq minutes, et une offre expirée il y a trois minutes doit être
 * visible telle qu'elle est plutôt que de disparaître sans explication.
 */
export async function listPendingOffers(
  locale: string,
  { limit = 100, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<AdminOfferEntry[]> {
  const rows = await prisma.offer.findMany({
    where: { status: 'PENDING', parentOfferId: null },
    // Ce qui expire en premier passe devant. Voir l'en-tête.
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: pendingOfferSelect,
  })

  return rows.map((row) => toEntry(row, locale, now))
}

/** Combien d'offres attendent une décision. Sert au tableau de bord. */
export async function countPendingOffers(): Promise<number> {
  return prisma.offer.count({ where: { status: 'PENDING', parentOfferId: null } })
}
