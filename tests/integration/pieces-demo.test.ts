import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  PIECE_ACHETABLE,
  PIECE_NEGOCIABLE,
  PIECE_VENDUE,
} from '../e2e/pieces-demo'

/**
 * Les trois pièces de démonstration dont les tests de navigateur dépendent.
 *
 * ---------------------------------------------------------------------------
 * Ce test existe pour ÉCHOUER VITE, et en disant pourquoi
 * ---------------------------------------------------------------------------
 * Le semis tire ses valeurs d'un générateur pseudo-aléatoire unique. Chaque
 * tirage avance le flux : ajouter un tirage quelque part déplace tout ce qui
 * suit — la marque, la taille et le prix des articles suivants, donc leur
 * adresse.
 *
 * C'est arrivé en ajoutant deux clés de mesure aux pantalons. Trois adresses
 * écrites en dur ont cessé d'exister et seize tests de navigateur sont tombés,
 * en huit minutes cumulées de délais d'attente, tous sur le même message :
 * « locator.click: Test timeout exceeded ». Aucun ne parlait de mesures,
 * aucun ne parlait du semis, et il a fallu remonter à la main du clic vers la
 * page, de la page vers l'adresse, de l'adresse vers le générateur.
 *
 * Ce fichier fait le même constat en une seconde, dans la suite rapide, en
 * nommant la pièce manquante et la propriété qui lui manque.
 *
 * ---------------------------------------------------------------------------
 * Il vérifie les PROPRIÉTÉS, pas seulement l'existence
 * ---------------------------------------------------------------------------
 * Une pièce qui existe mais qui a été vendue entre-temps, ou dont la fenêtre
 * d'offres n'est pas encore ouverte, casse les tests aussi sûrement qu'une
 * pièce absente — et de façon encore plus déroutante, puisque la page
 * s'affiche.
 */

afterAll(async () => {
  await prisma.$disconnect()
})

describe('les pièces de démonstration', () => {
  it('la pièce du parcours d’achat est disponible et publiée', async () => {
    const piece = await prisma.article.findUnique({
      where: { slug: PIECE_ACHETABLE },
      select: { status: true, publishedAt: true },
    })

    expect(piece, `${PIECE_ACHETABLE} est introuvable — le semis a bougé`).not.toBeNull()
    expect(piece!.status).toBe('AVAILABLE')
    expect(piece!.publishedAt).not.toBeNull()
    expect(piece!.publishedAt!.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('la pièce négociable accepte une offre à 30 €, sans l’accepter ni la refuser', async () => {
    const piece = await prisma.article.findUnique({
      where: { slug: PIECE_NEGOCIABLE },
      select: {
        status: true,
        publishedAt: true,
        allowOffers: true,
        offersOpenAt: true,
        priceCents: true,
        floorPriceCents: true,
      },
    })

    expect(piece, `${PIECE_NEGOCIABLE} est introuvable — le semis a bougé`).not.toBeNull()
    expect(piece!.status).toBe('AVAILABLE')
    expect(piece!.allowOffers).toBe(true)

    // La fenêtre d'offres doit être OUVERTE : sinon le formulaire ne s'affiche
    // pas, et le test de navigateur cherche un champ qui n'existe pas.
    expect(piece!.offersOpenAt).not.toBeNull()
    expect(piece!.offersOpenAt!.getTime()).toBeLessThanOrEqual(Date.now())

    // Et l'encadrement du montant que le test propose. Sous le prix demandé :
    // sinon l'offre n'a aucun sens. Au-dessus du plancher : sinon elle est
    // refusée sur-le-champ, et le test attend une réponse qui ne viendra pas.
    const PROPOSITION_CENTIMES = 3000
    expect(
      PROPOSITION_CENTIMES,
      'la proposition du test doit rester sous le prix affiché',
    ).toBeLessThan(piece!.priceCents)
    expect(
      PROPOSITION_CENTIMES,
      'la proposition du test doit rester au-dessus du plancher',
    ).toBeGreaterThan(piece!.floorPriceCents)
  })

  it('la pièce vendue l’est réellement, et sa fiche reste consultable', async () => {
    const piece = await prisma.article.findUnique({
      where: { slug: PIECE_VENDUE },
      select: { status: true, publishedAt: true },
    })

    expect(piece, `${PIECE_VENDUE} est introuvable — le semis a bougé`).not.toBeNull()
    expect(piece!.status).toBe('SOLD')
    // Publiée : une pièce vendue jamais publiée répondrait 404, et le test de
    // navigateur vérifie justement qu'elle répond 200.
    expect(piece!.publishedAt).not.toBeNull()
  })

  it('désigne trois pièces DISTINCTES', () => {
    // Le parcours d'achat met sa pièce au panier et la réserve ; le parcours
    // d'offres dépose une proposition sur la sienne. Partager une pièce entre
    // les deux les ferait échouer l'un par l'autre, au hasard de l'ordre
    // d'exécution — le pire mode de panne, parce qu'il est intermittent.
    const adresses = [PIECE_ACHETABLE, PIECE_NEGOCIABLE, PIECE_VENDUE]
    expect(new Set(adresses).size).toBe(adresses.length)
  })
})
