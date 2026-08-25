import { describe, it, expect } from 'vitest'
import { OrderStatus } from '@prisma/client'

import {
  planTransition,
  availableActions,
  needsFulfilment,
  normalizeTrackingNumber,
  type FulfilmentAction,
} from '@/lib/domain/fulfilment'

/**
 * La machine à états de l'expédition, exercée sans base.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi énumérer les VINGT-QUATRE combinaisons
 * ---------------------------------------------------------------------------
 * Huit états, trois gestes. Quatre couples sont autorisés ; les vingt autres
 * doivent être refusés. Tester seulement les quatre chemins heureux vérifierait
 * que la machine avance — pas qu'elle empêche quoi que ce soit, ce qui est
 * pourtant sa seule raison d'exister.
 *
 * Les états sont lus depuis Prisma plutôt que recopiés : un neuvième ajouté au
 * schéma entre dans ce test tout seul, avec un refus par défaut à justifier.
 */

const ACTIONS: FulfilmentAction[] = ['prepare', 'ship', 'deliver']

/** Les seuls couples (état, geste) que le domaine doit accepter. */
const AUTORISES: { from: OrderStatus; action: FulfilmentAction; to: OrderStatus }[] = [
  { from: 'PAID', action: 'prepare', to: 'PREPARING' },
  { from: 'PAID', action: 'ship', to: 'SHIPPED' },
  { from: 'PREPARING', action: 'ship', to: 'SHIPPED' },
  { from: 'SHIPPED', action: 'deliver', to: 'DELIVERED' },
]

function estAutorise(from: OrderStatus, action: FulfilmentAction): boolean {
  return AUTORISES.some((rule) => rule.from === from && rule.action === action)
}

describe('planTransition', () => {
  it('accepte les quatre couples prévus, et rien d’autre', () => {
    const inattendus: string[] = []

    for (const from of Object.values(OrderStatus)) {
      for (const action of ACTIONS) {
        const result = planTransition(from, action)
        if (result.ok !== estAutorise(from, action)) {
          inattendus.push(`${from} + ${action} → ok=${result.ok}`)
        }
      }
    }

    expect(inattendus).toEqual([])
  })

  it('mène à l’état annoncé', () => {
    for (const rule of AUTORISES) {
      expect(planTransition(rule.from, rule.action)).toEqual({
        ok: true,
        to: rule.to,
      })
    }
  })

  it('refuse de reculer', () => {
    // Le défaut que ce refus évite : un double clic sur une liste rafraîchie
    // repasse une commande livrée en préparation, et l'acheteuse voit son
    // colis « repartir » alors qu'elle l'a entre les mains.
    expect(planTransition('DELIVERED', 'prepare').ok).toBe(false)
    expect(planTransition('DELIVERED', 'ship').ok).toBe(false)
    expect(planTransition('SHIPPED', 'prepare').ok).toBe(false)
  })

  it('refuse de rejouer un geste déjà posé', () => {
    // Expédier une commande déjà expédiée n'est pas neutre : l'écriture
    // enverrait un second avis d'expédition pour un seul colis.
    expect(planTransition('SHIPPED', 'ship').ok).toBe(false)
    expect(planTransition('PREPARING', 'prepare').ok).toBe(false)
    expect(planTransition('DELIVERED', 'deliver').ok).toBe(false)
  })

  it('ne touche pas une commande annulée, remboursée ou impayée', () => {
    const hors: OrderStatus[] = [
      'PENDING_PAYMENT',
      'CANCELLED',
      'REFUNDED',
      'PARTIALLY_REFUNDED',
    ]

    for (const status of hors) {
      for (const action of ACTIONS) {
        expect(planTransition(status, action).ok, `${status} + ${action}`).toBe(
          false,
        )
      }
    }
  })

  it('saute l’étape de préparation quand c’est le même geste', () => {
    // Assumé, pas oublié : sur une boutique d'une seule personne, préparer et
    // expédier sont souvent le même geste dans la même heure. Imposer l'étape
    // ferait cliquer deux fois pour une seule action.
    expect(planTransition('PAID', 'ship')).toEqual({ ok: true, to: 'SHIPPED' })
  })
})

describe('availableActions', () => {
  it('propose exactement ce que planTransition accepterait', () => {
    const divergences: string[] = []

    for (const from of Object.values(OrderStatus)) {
      const proposes = availableActions(from)
      for (const action of ACTIONS) {
        const propose = proposes.includes(action)
        if (propose !== planTransition(from, action).ok) {
          divergences.push(`${from} + ${action}`)
        }
      }
    }

    // C'est la garantie que l'écran ne montre aucun bouton qui échouerait, et
    // n'en cache aucun qui marcherait.
    expect(divergences).toEqual([])
  })

  it('ne propose rien sur un état terminal ou hors parcours', () => {
    expect(availableActions('DELIVERED')).toEqual([])
    expect(availableActions('CANCELLED')).toEqual([])
    expect(availableActions('REFUNDED')).toEqual([])
    expect(availableActions('PENDING_PAYMENT')).toEqual([])
  })
})

describe('needsFulfilment', () => {
  it('ne retient que ce qui attend un geste du vendeur', () => {
    expect(needsFulfilment('PAID')).toBe(true)
    expect(needsFulfilment('PREPARING')).toBe(true)

    // Une commande expédiée n'attend plus rien de lui : c'est le transporteur,
    // puis l'acheteuse, qui font la suite.
    expect(needsFulfilment('SHIPPED')).toBe(false)
    expect(needsFulfilment('DELIVERED')).toBe(false)
    expect(needsFulfilment('PENDING_PAYMENT')).toBe(false)
    expect(needsFulfilment('CANCELLED')).toBe(false)
  })

  it('ne retient aucun état d’où aucun geste ne part', () => {
    // Une file de travail dont une ligne n'offre aucun bouton est une ligne
    // qu'on regarde tous les jours sans pouvoir la faire disparaître.
    for (const status of Object.values(OrderStatus)) {
      if (needsFulfilment(status)) {
        expect(availableActions(status).length, status).toBeGreaterThan(0)
      }
    }
  })
})

describe('normalizeTrackingNumber', () => {
  it('retire les espaces des groupes imprimés sur le bordereau', () => {
    // Le défaut évité : un suivi recopié « 6A 1234 5678 9 » ne correspond à
    // rien chez le transporteur, et l'acheteuse croit son colis perdu.
    expect(normalizeTrackingNumber('6A 1234 5678 9')).toBe('6A123456789')
  })

  it('absorbe les espaces multiples, les tabulations et les bords', () => {
    expect(normalizeTrackingNumber('  6A\t1234   5678  ')).toBe('6A12345678')
  })

  it('met en capitales', () => {
    // Les préfixes de transporteur sont imprimés en capitales ; une saisie au
    // clavier mobile arrive parfois en minuscules, et deux écritures du même
    // numéro se compareraient comme deux numéros différents.
    expect(normalizeTrackingNumber('la123456789fr')).toBe('LA123456789FR')
  })

  it('laisse intact un numéro déjà propre', () => {
    expect(normalizeTrackingNumber('LA123456789FR')).toBe('LA123456789FR')
  })
})
