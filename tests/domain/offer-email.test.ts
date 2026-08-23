import { describe, it, expect, vi } from 'vitest'

/**
 * Ce que ces gabarits promettent — et ce qu'ils ne doivent jamais promettre.
 *
 * Un e-mail d'acceptation est le moment où quelqu'un croit la pièce acquise.
 * C'est précisément là qu'il faut dire qu'elle ne l'est pas : sur un stock où
 * chaque pièce existe en un seul exemplaire, elle reste en vente au prix
 * affiché jusqu'à ce que quelqu'un la paie.
 */

/**
 * `LEGAL.email` est figée au chargement du module — c'est une constante lue
 * une fois dans `lib/config/site.ts`, et `vi.stubEnv` arrive trop tard. On
 * remplace donc l'identité légale, en gardant tout le reste du module :
 * `SITE.name` sert à la signature des messages.
 */
vi.mock('@/lib/config/site', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/site')>()
  return {
    ...actual,
    LEGAL: { ...actual.LEGAL, email: 'boutique@nina-diego.test' },
  }
})

const {
  buildOfferAcknowledgement,
  buildOfferShopNotice,
} = await import('@/lib/providers/email/offer')
type OfferEmailData = import('@/lib/providers/email/offer').OfferEmailData

const DATA: OfferEmailData = {
  locale: 'fr',
  email: 'negociatrice@exemple.fr',
  reference: 'ART-000051',
  title: 'Chemise en coton rayée',
  amountCents: 3000,
  outcome: 'pending',
  expiresAt: new Date('2026-08-22T12:00:00.000Z'),
  priceValidUntil: null,
  url: 'https://boutique.test/fr/a/chemises-l-51',
}

describe('accusé de proposition', () => {
  it('dit le montant, la référence et l’échéance', async () => {
    const message = await buildOfferAcknowledgement(DATA)

    expect(message.to).toBe(DATA.email)
    expect(message.subject).toContain('ART-000051')
    expect(message.text).toContain('30,00')
    expect(message.text).toContain('Chemise en coton rayée')
    expect(message.text).toContain('22 août 2026')
    expect(message.text).toContain(DATA.url)
  })

  it('ANNONCE que la pièce n’est pas mise de côté, y compris sur une acceptation', async () => {
    for (const outcome of ['pending', 'accepted', 'rejected'] as const) {
      const message = await buildOfferAcknowledgement({
        ...DATA,
        outcome,
        priceValidUntil:
          outcome === 'accepted' ? new Date('2026-08-21T12:00:00.000Z') : null,
      })

      // C'est au moment où l'on croit la pièce acquise que l'information
      // compte le plus. La retirer de l'acceptation serait la retirer de là où
      // elle sert.
      expect(message.text, outcome).toContain('ne met pas la pièce de côté')
    }
  })

  it('dit la validité du prix sur une acceptation', async () => {
    const message = await buildOfferAcknowledgement({
      ...DATA,
      outcome: 'accepted',
      priceValidUntil: new Date('2026-08-21T12:00:00.000Z'),
    })

    expect(message.subject).toContain('acceptée')
    expect(message.text).toContain('21 août 2026')
  })

  it('n’invente aucune raison sur un refus', async () => {
    const message = await buildOfferAcknowledgement({
      ...DATA,
      outcome: 'rejected',
    })

    // Le minimum de la pièce et le prix plancher sont PRIVÉS. Dire « il
    // fallait proposer au moins 21,00 € » livrerait le seuil de refus
    // automatique, qu'il suffirait alors d'effleurer.
    expect(message.text).toContain('n’a pas été retenue')
    expect(message.text).not.toMatch(/plancher|minimum|au moins/i)
  })

  it('suit la langue de la fiche', async () => {
    const message = await buildOfferAcknowledgement({ ...DATA, locale: 'en' })
    expect(message.text).toContain('An answer is due by')
  })

  it('renvoie vers la boutique, pas vers l’adresse d’envoi', async () => {
    const message = await buildOfferAcknowledgement(DATA)
    expect(message.replyTo).toBe('boutique@nina-diego.test')
  })
})

describe('avis à la boutique', () => {
  it('porte de quoi décider, et rien de plus', async () => {
    const message = buildOfferShopNotice(DATA)

    expect(message.to).toBe('boutique@nina-diego.test')
    expect(message.subject).toContain('ART-000051')
    expect(message.text).toContain('30,00')
    expect(message.text).toContain(DATA.url)
    // L'échéance est ce qui rend l'avis urgent : sans réponse, l'offre
    // s'éteint toute seule.
    expect(message.text).toContain('22 août 2026')
  })

  it('permet de répondre directement à la personne', async () => {
    // Répondre à l'avis écrit à qui a proposé : c'est ce qu'on veut faire neuf
    // fois sur dix.
    expect(buildOfferShopNotice(DATA).replyTo).toBe(DATA.email)
  })
})
