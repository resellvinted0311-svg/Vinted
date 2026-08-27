import { describe, it, expect } from 'vitest'
import type { ArticleStatus } from '@prisma/client'

import {
  planListing,
  availableListingActions,
  isEditable,
  type ListingSubject,
} from '@/lib/domain/article-listing'

/**
 * Mettre une pièce en vente, ou l'en retirer.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ces règles méritent un module pur
 * ---------------------------------------------------------------------------
 * Chacun des refus ci-dessous correspond à une façon connue de perdre de
 * l'argent ou une cliente : republier une pièce vendue, archiver sous le
 * paiement de quelqu'un, publier une fiche sans photo que personne n'ouvrira,
 * ou laisser une pièce « en vente » que le catalogue n'affiche pas.
 *
 * Écrites à l'intérieur d'une requête, ces règles ne s'exercent qu'avec une
 * base et un jeu de données ; on écrit alors les cas passants et on oublie les
 * refus. Ici, les vingt combinaisons tiennent en un fichier sans base.
 */

const BASE: ListingSubject = {
  status: 'DRAFT',
  hasImage: true,
  lockLive: false,
  awaitingPayment: false,
}

const subject = (over: Partial<ListingSubject>): ListingSubject => ({
  ...BASE,
  ...over,
})

describe('publier', () => {
  it('met en vente un brouillon qui a au moins une photo', () => {
    expect(planListing('publish', subject({ status: 'DRAFT' }))).toEqual({
      ok: true,
      to: 'AVAILABLE',
      setPublishedAt: true,
      clearReservation: true,
    })
  })

  it('remet en vente une pièce retirée', () => {
    // « Restaurer » n'est pas un geste distinct : c'est publier.
    expect(planListing('publish', subject({ status: 'ARCHIVED' })).ok).toBe(true)
  })

  it('REFUSE une pièce sans photo', () => {
    // Une fiche sans visuel est une fiche que personne n'ouvre — et la vignette
    // du catalogue serait vide.
    expect(planListing('publish', subject({ hasImage: false }))).toEqual({
      ok: false,
      reason: 'no-image',
    })
  })

  it('REFUSE une pièce déjà en vente', () => {
    expect(
      planListing('publish', subject({ status: 'AVAILABLE' })),
    ).toEqual({ ok: false, reason: 'already-listed' })
  })

  it('REFUSE une pièce vendue', () => {
    // Son prix, son titre et son état figurent sur une facture qui a valeur
    // comptable pendant dix ans.
    expect(planListing('publish', subject({ status: 'SOLD' }))).toEqual({
      ok: false,
      reason: 'sold',
    })
  })

  it('REFUSE une pièce dont le verrou court encore', () => {
    expect(
      planListing('publish', subject({ status: 'RESERVED', lockLive: true })),
    ).toEqual({ ok: false, reason: 'reserved' })
  })

  it('ACCEPTE une pièce dont le verrou est échu, et efface le réservataire', () => {
    // Le balayage qui libère les verrous échus passe toutes les cinq minutes :
    // une pièce peut porter RESERVED alors que son verrou est mort depuis
    // quatre minutes. Bloquer la boutiquière là-dessus n'aurait aucun sens.
    expect(
      planListing('publish', subject({ status: 'RESERVED', lockLive: false })),
    ).toEqual({
      ok: true,
      to: 'AVAILABLE',
      setPublishedAt: true,
      // Sans cela, la pièce traînerait l'identité de son ancien réservataire —
      // colonne classée privée — et un verrou fantôme fausserait le prochain
      // calcul de disponibilité.
      clearReservation: true,
    })
  })
})

describe('retirer', () => {
  it('retire une pièce en vente', () => {
    expect(planListing('withdraw', subject({ status: 'AVAILABLE' }))).toEqual({
      ok: true,
      to: 'ARCHIVED',
      setPublishedAt: false,
      clearReservation: false,
    })
  })

  it('retire un brouillon', () => {
    expect(planListing('withdraw', subject({ status: 'DRAFT' })).ok).toBe(true)
  })

  it('REFUSE de retirer une pièce réservée', () => {
    expect(
      planListing('withdraw', subject({ status: 'AVAILABLE', lockLive: true })),
    ).toEqual({ ok: false, reason: 'reserved' })
  })

  it('REFUSE de retirer une pièce dont une commande attend son paiement', () => {
    // Le cas le plus coûteux de tous. Stripe ne garantit ni l'ordre ni le délai
    // de ses webhooks, et l'encaissement ROUVRE une commande déjà annulée. Une
    // pièce retirée entre-temps sort de la clause que l'encaissement exige :
    // l'argent est pris, la commande passe payée, une facture est numérotée —
    // et la pièce n'est jamais marquée vendue.
    expect(
      planListing(
        'withdraw',
        subject({ status: 'AVAILABLE', awaitingPayment: true }),
      ),
    ).toEqual({ ok: false, reason: 'awaiting-payment' })
  })

  it('REFUSE une pièce déjà retirée', () => {
    expect(planListing('withdraw', subject({ status: 'ARCHIVED' }))).toEqual({
      ok: false,
      reason: 'already-withdrawn',
    })
  })

  it('REFUSE une pièce vendue', () => {
    expect(planListing('withdraw', subject({ status: 'SOLD' }))).toEqual({
      ok: false,
      reason: 'sold',
    })
  })
})

describe('aucun geste ne fabrique un état impossible', () => {
  const STATUSES: ArticleStatus[] = [
    'DRAFT',
    'SCHEDULED',
    'AVAILABLE',
    'RESERVED',
    'SOLD',
    'ARCHIVED',
  ]

  it('ne produit jamais SOLD ni SCHEDULED, sur aucune combinaison', () => {
    // `SOLD` s'écrit à l'encaissement et nulle part ailleurs : le poser à la
    // main mentirait sur une vente qui n'a pas eu lieu. `SCHEDULED` demande une
    // date de parution et un balayage qui la surveille — sans eux, l'état
    // serait sans issue.
    for (const status of STATUSES) {
      for (const hasImage of [true, false]) {
        for (const lockLive of [true, false]) {
          for (const awaitingPayment of [true, false]) {
            for (const action of ['publish', 'withdraw'] as const) {
              const plan = planListing(action, {
                status,
                hasImage,
                lockLive,
                awaitingPayment,
              })
              if (plan.ok) {
                expect(plan.to).not.toBe('SOLD')
                expect(plan.to).not.toBe('SCHEDULED')
              }
            }
          }
        }
      }
    }
  })

  it('ne met JAMAIS en vente sans photo, quelle que soit la combinaison', () => {
    // C'est la garantie que la vignette du catalogue n'est jamais vide.
    for (const status of STATUSES) {
      for (const lockLive of [true, false]) {
        for (const awaitingPayment of [true, false]) {
          const plan = planListing('publish', {
            status,
            hasImage: false,
            lockLive,
            awaitingPayment,
          })
          expect(plan.ok, `${status} verrou=${lockLive}`).toBe(false)
        }
      }
    }
  })

  it('ne touche JAMAIS une pièce vendue', () => {
    for (const action of ['publish', 'withdraw'] as const) {
      for (const hasImage of [true, false]) {
        const plan = planListing(action, subject({ status: 'SOLD', hasImage }))
        expect(plan).toEqual({ ok: false, reason: 'sold' })
      }
    }
  })
})

describe('les gestes proposés à l’écran', () => {
  it('n’offrent que ce que le serveur accepterait', () => {
    // La liste ne protège rien — `planListing` est rejoué dans la transaction.
    // Ce qu'elle apporte est plus modeste : ne pas faire cliquer pour rien.
    expect(availableListingActions(subject({ status: 'DRAFT' }))).toEqual([
      'publish',
      'withdraw',
    ])
    expect(availableListingActions(subject({ status: 'AVAILABLE' }))).toEqual([
      'withdraw',
    ])
    expect(availableListingActions(subject({ status: 'SOLD' }))).toEqual([])
    expect(
      availableListingActions(subject({ status: 'AVAILABLE', lockLive: true })),
    ).toEqual([])
  })
})

describe('la modification du contenu', () => {
  it('est permise sur un brouillon, une pièce en vente et une pièce retirée', () => {
    for (const status of ['DRAFT', 'AVAILABLE', 'ARCHIVED'] as const) {
      expect(isEditable({ status, lockLive: false }), status).toBe(true)
    }
  })

  it('est REFUSÉE sur une pièce vendue', () => {
    // Corriger le prix d'une pièce vendue réécrirait ce qu'une facture affirme.
    expect(isEditable({ status: 'SOLD', lockLive: false })).toBe(false)
  })

  it('est REFUSÉE tant qu’un paiement est en cours', () => {
    // L'acheteuse a vu un montant à l'écran ; elle en paierait un autre.
    expect(isEditable({ status: 'AVAILABLE', lockLive: true })).toBe(false)
    expect(isEditable({ status: 'RESERVED', lockLive: true })).toBe(false)
  })
})
