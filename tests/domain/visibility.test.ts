import { describe, it, expect } from 'vitest'
import {
  isArticleVisible,
  isArticleListed,
  isReservationLive,
  visibleArticleWhere,
  listedArticleWhere,
  LISTED_STATUSES,
  VISIBLE_STATUSES,
} from '@/lib/db/visibility'

/**
 * La règle de visibilité était réécrite à la main à quatre endroits et ils
 * avaient divergé. Ces tests fixent la règle une fois.
 */

const NOW = new Date('2026-08-21T12:00:00Z')
const PUBLISHED = new Date('2026-08-01T09:00:00Z')

describe('visibilité d’un article', () => {
  it('une pièce retirée du registre n’est plus consultable', () => {
    // C'est le défaut corrigé : la page Favoris l'affichait encore, avec son
    // prix, et le lien menait à une fiche introuvable.
    expect(
      isArticleVisible({ status: 'ARCHIVED', publishedAt: PUBLISHED }, NOW),
    ).toBe(false)
  })

  it('une pièce vendue reste consultable mais quitte les grilles', () => {
    const sold = { status: 'SOLD', publishedAt: PUBLISHED } as const

    // Renvoyer 404 sur une pièce vendue détruirait le référencement acquis.
    expect(isArticleVisible(sold, NOW)).toBe(true)
    // Une grille sert à choisir : on n'y propose pas ce qui est parti.
    expect(isArticleListed(sold, NOW)).toBe(false)
  })

  it('une pièce réservée reste listée', () => {
    const reserved = { status: 'RESERVED', publishedAt: PUBLISHED } as const

    // La réservation expire le plus souvent : la masquer ferait disparaître
    // puis réapparaître des pièces sans explication.
    expect(isArticleListed(reserved, NOW)).toBe(true)
  })

  it('un brouillon n’existe pour personne', () => {
    expect(isArticleVisible({ status: 'DRAFT', publishedAt: null }, NOW)).toBe(
      false,
    )
  })

  it('une publication programmée n’apparaît pas avant l’heure', () => {
    const scheduled = {
      status: 'AVAILABLE',
      publishedAt: new Date('2026-08-22T08:00:00Z'),
    } as const

    expect(isArticleVisible(scheduled, NOW)).toBe(false)
    expect(isArticleListed(scheduled, NOW)).toBe(false)

    // …et apparaît à l'heure dite.
    const later = new Date('2026-08-22T08:00:01Z')
    expect(isArticleListed(scheduled, later)).toBe(true)
  })

  it('les clauses Prisma disent la même chose que les prédicats', () => {
    const visible = visibleArticleWhere(NOW)
    const listed = listedArticleWhere(NOW)

    expect(visible.status).toEqual({ in: [...VISIBLE_STATUSES] })
    expect(listed.status).toEqual({ in: [...LISTED_STATUSES] })

    // La date de publication est vérifiée des DEUX côtés : « renseignée » ne
    // suffit pas, il faut aussi qu'elle soit passée. Le compteur d'accueil
    // oubliait la seconde moitié et annonçait des pièces inouvrables.
    for (const where of [visible, listed]) {
      expect(where.publishedAt).toEqual({ not: null, lte: NOW })
    }
  })
})

describe('affichage d’une réservation', () => {
  it('reste affichée tant que l’échéance n’est pas passée', () => {
    expect(
      isReservationLive(
        { status: 'RESERVED', reservedUntil: new Date('2026-08-21T12:10:00Z') },
        NOW,
      ),
    ).toBe(true)
  })

  it('disparaît à l’échéance, sans attendre le balayage', () => {
    // C'est le défaut corrigé : le statut ne redevient AVAILABLE qu'au passage
    // de la tâche planifiée. Si elle ne tourne pas, un panier abandonné
    // retirait la pièce de la vente aux yeux de tout le monde, sans limite.
    expect(
      isReservationLive(
        { status: 'RESERVED', reservedUntil: new Date('2026-08-21T11:59:59Z') },
        NOW,
      ),
    ).toBe(false)
  })

  it('ne s’affiche pas sans échéance ni sur un autre statut', () => {
    expect(isReservationLive({ status: 'RESERVED', reservedUntil: null }, NOW)).toBe(
      false,
    )
    expect(
      isReservationLive(
        { status: 'AVAILABLE', reservedUntil: new Date('2026-08-21T12:10:00Z') },
        NOW,
      ),
    ).toBe(false)
  })
})
