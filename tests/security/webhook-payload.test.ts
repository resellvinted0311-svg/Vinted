import { describe, it, expect } from 'vitest'
import type Stripe from 'stripe'
import { redactStripeEvent } from '@/lib/payments/webhook-payload'

/**
 * Ce qu'on archive d'un événement de paiement.
 *
 * Le défaut d'origine : l'événement Stripe ENTIER était écrit en base et n'en
 * repartait jamais. Or un `checkout.session.completed` transporte
 * `customer_details` — nom, adresse e-mail, téléphone, adresse postale
 * complète. C'était une seconde copie des données de la personne, hors du
 * registre des traitements, hors de l'export de l'article 15, et hors de
 * l'effacement de l'article 17 : on vidait soigneusement la commande, et la
 * copie restait à côté.
 */

/** Un événement réaliste, avec tout ce que Stripe y met vraiment. */
function anEvent(): Stripe.Event {
  return {
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    created: 1_760_000_000,
    livemode: false,
    object: 'event',
    api_version: '2026-07-29.dahlia',
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: 'cs_test_abc',
        object: 'checkout.session',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 6790,
        amount_subtotal: 6300,
        currency: 'eur',
        mode: 'payment',
        client_reference_id: 'ordre-123',
        payment_intent: 'pi_test_xyz',
        expires_at: 1_760_001_800,
        customer_email: 'acheteuse@exemple.fr',
        customer_details: {
          email: 'acheteuse@exemple.fr',
          name: 'Nina Exemple',
          phone: '0600000000',
          address: {
            line1: '12 rue du Registre',
            line2: null,
            postal_code: '59000',
            city: 'Lille',
            country: 'FR',
            state: null,
          },
          tax_exempt: 'none',
          tax_ids: [],
        },
        shipping_details: {
          name: 'Nina Exemple',
          address: {
            line1: '12 rue du Registre',
            postal_code: '59000',
            city: 'Lille',
            country: 'FR',
          },
        },
        metadata: {
          orderId: 'ordre-123',
          orderNumber: 'CMD-2026-000042',
        },
      },
    },
  } as unknown as Stripe.Event
}

describe('caviardage d’un événement de paiement', () => {
  it('ne laisse AUCUNE coordonnée dans ce qui est archivé', () => {
    const archived = JSON.stringify(redactStripeEvent(anEvent()))

    // On cherche les VALEURS, pas les noms de champs : une donnée recopiée
    // sous une autre clé passerait à travers un contrôle par clé.
    expect(archived).not.toContain('acheteuse@exemple.fr')
    expect(archived).not.toContain('Nina Exemple')
    expect(archived).not.toContain('0600000000')
    expect(archived).not.toContain('rue du Registre')
    expect(archived).not.toContain('59000')
    expect(archived).not.toContain('Lille')

    // Et les conteneurs eux-mêmes ne doivent pas subsister.
    expect(archived).not.toContain('customer_details')
    expect(archived).not.toContain('shipping_details')
    expect(archived).not.toContain('customer_email')
  })

  it('garde de quoi comprendre un échec d’encaissement', () => {
    const redacted = redactStripeEvent(anEvent())

    expect(redacted.id).toBe('evt_test_1')
    expect(redacted.type).toBe('checkout.session.completed')
    expect(redacted.livemode).toBe(false)
    expect(redacted.object.id).toBe('cs_test_abc')
    expect(redacted.object.payment_status).toBe('paid')
    expect(redacted.object.amount_total).toBe(6790)
    expect(redacted.object.currency).toBe('eur')
    expect(redacted.object.payment_intent).toBe('pi_test_xyz')
    // Le repère qui relie la trace à notre propre commande.
    expect(redacted.object['metadata.orderNumber']).toBe('CMD-2026-000042')
  })

  it('refuse tout champ NON scalaire, même inconnu', () => {
    // La forme des événements appartient à Stripe. Un champ ajouté demain par
    // une version future de leur interface ne doit pas arriver dans nos
    // journaux parce que personne n'a pensé à l'exclure. C'est le sens de la
    // liste blanche.
    const event = anEvent()
    const objet = event.data.object as unknown as Record<string, unknown>
    objet.nouveau_champ_avec_identite = {
      nom: 'Quelqu’un',
      adresse: '3 rue Inventée',
    }
    objet.status = { valeur: 'complete', client: 'Nina' }

    const archived = JSON.stringify(redactStripeEvent(event))

    expect(archived).not.toContain('nouveau_champ_avec_identite')
    expect(archived).not.toContain('rue Inventée')
    // `status` est pourtant dans la liste blanche : ce n'est plus un scalaire,
    // il est écarté quand même.
    expect(archived).not.toContain('Nina')
  })

  it('ne reprend pas les métadonnées en bloc', () => {
    // Seules les deux clés que nous posons nous-mêmes sont reprises. Le jour
    // où quelqu'un ajoutera un nom aux métadonnées, il ne partira pas ici.
    const event = anEvent()
    const objet = event.data.object as unknown as Record<string, unknown>
    ;(objet.metadata as Record<string, unknown>).acheteuse = 'Nina Exemple'

    const archived = JSON.stringify(redactStripeEvent(event))

    expect(archived).toContain('CMD-2026-000042')
    expect(archived).not.toContain('Nina Exemple')
  })
})
