import { describe, it, expect } from 'vitest'
import {
  buildOrderConfirmation,
  buildShipmentNotice,
  buildShopNotification,
  type OrderEmailData,
  type ShipmentEmailData,
} from '@/lib/providers/email/order'
import { SITE, LEGAL } from '@/lib/config/site'

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

/**
 * L'avis d'expédition — le seul e-mail que personne ne construisait en test.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ces tests ont attrapé
 * ---------------------------------------------------------------------------
 * `buildShipmentNotice` appelait `t('signature')` sans lui passer `{shop}`,
 * alors que les huit catalogues écrivent « À bientôt, {shop} ». Il manquait
 * une valeur à une variable de message : `createTranslator` ne rend alors pas
 * la phrase, il rend le CHEMIN de la clé — `orderEmail.signature` — au beau
 * milieu du message.
 *
 * Rien ne pouvait le signaler. Le message part de la file de travaux, dans la
 * transaction qui fait passer la commande à « expédiée » : aucune page ne
 * l'affiche, aucun test ne l'appelait, et la boutique n'en reçoit pas de
 * copie. Seule l'acheteuse le voyait, une fois, à un moment où elle attend son
 * colis et non un défaut d'affichage.
 *
 * Les assertions ci-dessous vérifient donc d'abord ce point précis, puis la
 * même chose pour toutes les autres phrases du message : aucune ne doit
 * ressembler à un chemin de clé.
 */
const EXPEDITION: ShipmentEmailData = {
  orderNumber: 'CMD-2026-000042',
  locale: 'fr',
  email: 'acheteuse@exemple.fr',
  trackingNumber: '6A11111111111',
  trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A1',
  shipping: BASE.shipping,
}

describe('avis d’expédition', () => {
  it('signe avec le nom de la boutique, pas avec le nom de la clé', async () => {
    const message = await buildShipmentNotice(EXPEDITION)

    expect(message.text).toContain(SITE.name)
    expect(
      message.text,
      'une variable de message non fournie fait rendre le chemin de la clé',
    ).not.toContain('orderEmail.')
  })

  it('ne laisse AUCUNE clé non rendue dans le message', async () => {
    // Garde-fou de portée : la signature n'était pas un cas isolé, c'était le
    // seul gabarit sans test. La règle vaut pour toutes ses phrases.
    const message = await buildShipmentNotice(EXPEDITION)

    expect(message.text).not.toMatch(/orderEmail\.[a-zA-Z.]+/)
    expect(message.html).not.toMatch(/orderEmail\.[a-zA-Z.]+/)
  })

  it('porte le numéro de suivi et son lien', async () => {
    const message = await buildShipmentNotice(EXPEDITION)

    expect(message.to).toBe('acheteuse@exemple.fr')
    expect(message.subject).toContain('CMD-2026-000042')
    expect(message.text).toContain('6A11111111111')
    expect(message.text).toContain('https://www.laposte.fr/')
    // Cliquable dans la version HTML : recopier une URL de suivi à la main
    // depuis un e-mail est exactement ce qu'on demande de ne pas faire.
    expect(message.html).toContain('<a href="https://www.laposte.fr/')
  })

  it('dit qu’il n’y a pas de suivi plutôt que de sauter la ligne', async () => {
    // Une ligne absente se lit comme un oubli et provoque la question ;
    // l'écrire ferme le sujet.
    const message = await buildShipmentNotice({
      ...EXPEDITION,
      trackingNumber: null,
      trackingUrl: null,
    })

    expect(message.text.length).toBeGreaterThan(50)
    expect(message.text).not.toContain('6A11111111111')
    expect(message.html).not.toContain('<a href')
  })

  it('est écrit dans la langue de la commande', async () => {
    const german = await buildShipmentNotice({ ...EXPEDITION, locale: 'de' })
    expect(german.subject).toContain('Bestellung')
    expect(german.text).toContain(SITE.name)
  })

  it('permet de répondre à la boutique', async () => {
    // « Où en est mon colis ? » est LA réponse attendue à ce message. Sans
    // `replyTo`, elle part vers l'adresse d'envoi, que personne ne lit.
    const message = await buildShipmentNotice(EXPEDITION)
    expect(message.replyTo).toBe(LEGAL.email || undefined)
  })

  it('échappe une adresse de livraison qui contient du HTML', async () => {
    const message = await buildShipmentNotice({
      ...EXPEDITION,
      shipping: { ...BASE.shipping, line1: '<img src=x onerror=alert(1)>' },
    })

    expect(message.html).not.toContain('<img')
    expect(message.html).toContain('&lt;img')
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
