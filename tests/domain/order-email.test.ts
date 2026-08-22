import { describe, it, expect } from 'vitest'
import {
  buildOrderConfirmation,
  buildShopNotification,
  type OrderEmailData,
} from '@/lib/providers/email/order'

/**
 * Gabarits d'e-mail de commande.
 *
 * Deux choses s'y jouent : que la personne reçoive sa confirmation dans SA
 * langue, et qu'un titre d'article — qui vient de la base — ne puisse pas
 * casser le HTML du message.
 */

const BASE: OrderEmailData = {
  orderNumber: 'CMD-2026-000042',
  locale: 'fr',
  email: 'acheteuse@exemple.fr',
  lines: [
    { title: 'Veste en laine', reference: 'ND-0142', unitPriceCents: 4500 },
    { title: 'Chemise rayée', reference: null, unitPriceCents: 1800 },
  ],
  subtotalCents: 6300,
  discountCents: 0,
  shippingCents: 490,
  totalCents: 6790,
  shipping: {
    firstName: 'Nina',
    lastName: 'Exemple',
    line1: '12 rue du Registre',
    postalCode: '59000',
    city: 'Lille',
    country: 'FR',
  },
  invoiceNumber: 'FA-000007',
}

describe('confirmation de commande', () => {
  it('reprend le numéro, les lignes et le total payé', async () => {
    const message = await buildOrderConfirmation(BASE)

    expect(message.to).toBe('acheteuse@exemple.fr')
    expect(message.subject).toContain('CMD-2026-000042')
    expect(message.text).toContain('Veste en laine')
    expect(message.text).toContain('ND-0142')
    expect(message.text).toContain('67,90')
    expect(message.text).toContain('FA-000007')
  })

  it('est écrite dans la langue de la commande', async () => {
    const german = await buildOrderConfirmation({ ...BASE, locale: 'de' })
    const polish = await buildOrderConfirmation({ ...BASE, locale: 'pl' })

    expect(german.subject).toContain('Bestellung')
    expect(polish.subject).toContain('zamówienie')
    // Et le montant suit la convention locale.
    expect(german.text).toContain('67,90')
  })

  it('retombe sur le français pour une langue inconnue', async () => {
    // Une commande ancienne, une langue retirée du site : mieux vaut un
    // message lisible qu'un message vide.
    const message = await buildOrderConfirmation({ ...BASE, locale: 'xx' })
    expect(message.text.length).toBeGreaterThan(50)
    expect(message.text).toContain('CMD-2026-000042')
  })

  it('dit « offerte » plutôt que zéro euro', async () => {
    const message = await buildOrderConfirmation({
      ...BASE,
      shippingCents: 0,
      totalCents: 6300,
    })

    expect(message.text).toContain('offerte')
  })

  it('ne mentionne une remise que s’il y en a une', async () => {
    const without = await buildOrderConfirmation(BASE)
    expect(without.text).not.toContain('Remise')

    const with_ = await buildOrderConfirmation({ ...BASE, discountCents: 500 })
    expect(with_.text).toContain('Remise')
  })

  it('n’affiche pas de ligne d’adresse vide', async () => {
    const message = await buildOrderConfirmation({
      ...BASE,
      shipping: { firstName: 'Nina', city: 'Lille' },
    })

    // Aucun tiret, aucune ligne fantôme pour combler un champ absent.
    expect(message.text).not.toMatch(/\n\s*\n\s*\n/)
    expect(message.text).toContain('Nina')
    expect(message.text).toContain('Lille')
  })

  it('échappe un titre d’article qui contient du HTML', async () => {
    // Le titre vient de la base : il ne doit pas pouvoir fermer une balise ni
    // ouvrir la sienne dans le message.
    const message = await buildOrderConfirmation({
      ...BASE,
      lines: [
        {
          title: '<img src=x onerror=alert(1)>',
          reference: null,
          unitPriceCents: 1000,
        },
      ],
    })

    expect(message.html).not.toContain('<img')
    expect(message.html).toContain('&lt;img')
  })

  it('fournit toujours une version texte', async () => {
    // Certains clients de messagerie n'affichent que celle-ci, et une
    // confirmation illisible est une confirmation qui n'existe pas.
    const message = await buildOrderConfirmation(BASE)
    expect(message.text.trim().length).toBeGreaterThan(0)
    expect(message.html.trim().length).toBeGreaterThan(0)
  })
})

describe('avis à la boutique', () => {
  it('contient ce qu’il faut pour aller chercher les pièces', async () => {
    const message = buildShopNotification(BASE)

    expect(message.subject).toContain('CMD-2026-000042')
    expect(message.text).toContain('ND-0142')
    expect(message.text).toContain('Lille')
    // Répondre à l'avis répond à l'acheteuse.
    expect(message.replyTo).toBe('acheteuse@exemple.fr')
  })
})
