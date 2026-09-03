import { describe, it, expect } from 'vitest'
import {
  deliveryUrl,
  MAX_DELIVERY_WIDTH,
} from '@/lib/providers/storage/delivery'

/**
 * L'adresse par laquelle une image est servie.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces tests protègent
 * ---------------------------------------------------------------------------
 * Une fonction qui réécrit des adresses a deux façons de nuire, et les deux
 * sont silencieuses.
 *
 * Elle peut casser une adresse qui marchait : l'image ne s'affiche plus, mais
 * seulement en production, seulement sur les visuels réhébergés, et le jeu de
 * démonstration continue de passer. C'est le sens des cas « laissée
 * intacte » : tout ce qui n'est pas exactement une adresse de livraison
 * connue doit ressortir tel quel.
 *
 * Elle peut aussi ne rien faire : l'adresse ressort inchangée, les images
 * s'affichent, et l'économie qu'on croyait avoir faite n'existe pas. Rien ne
 * le signale — c'est exactement l'état d'avant. D'où les assertions positives
 * sur le contenu du segment inséré.
 */

const ORIGINAL =
  'https://res.cloudinary.com/nina-diego/image/upload/v1712345678/articles/veste-en-laine.webp'

describe('l’adresse de livraison', () => {
  it('insère la transformation juste après « /upload/ »', () => {
    const servie = deliveryUrl(ORIGINAL)

    expect(servie).toBe(
      `https://res.cloudinary.com/nina-diego/image/upload/f_auto,q_auto,c_limit,w_${MAX_DELIVERY_WIDTH}/v1712345678/articles/veste-en-laine.webp`,
    )
  })

  it('borne la largeur demandée au plafond', () => {
    // Un appelant qui demanderait la pleine résolution obtiendrait l'original,
    // c'est-à-dire précisément ce qu'on veut éviter.
    expect(deliveryUrl(ORIGINAL, { width: 99_999 })).toContain(
      `w_${MAX_DELIVERY_WIDTH}`,
    )
  })

  it('accepte une largeur plus petite, et la respecte', () => {
    expect(deliveryUrl(ORIGINAL, { width: 640 })).toContain('w_640')
  })

  it('refuse une largeur absurde plutôt que d’écrire une adresse invalide', () => {
    // `w_0` et `w_-1` ne sont pas des transformations valides : l'hébergeur
    // répondrait 400, et l'image disparaîtrait de la page.
    expect(deliveryUrl(ORIGINAL, { width: 0 })).toContain('w_1')
    expect(deliveryUrl(ORIGINAL, { width: -300 })).toContain('w_1')
    expect(deliveryUrl(ORIGINAL, { width: 12.6 })).toContain('w_13')
  })

  it('recadre avec « c_limit », qui réduit sans jamais couper ni agrandir', () => {
    // `c_fill` couperait le vêtement, `c_scale` fabriquerait des pixels. Le
    // choix n'est pas cosmétique : il porte sur ce que la cliente VOIT.
    const servie = deliveryUrl(ORIGINAL)
    expect(servie).toContain('c_limit')
    expect(servie).not.toContain('c_fill')
    expect(servie).not.toContain('c_scale')
  })

  it('laisse intacte une adresse déjà transformée', () => {
    // Empiler deux listes de transformations ferait payer deux passages pour
    // un seul résultat — et la première l'a été pour une raison qu'on ignore
    // ici.
    const deja =
      'https://res.cloudinary.com/nina-diego/image/upload/w_400,c_fill/v1/articles/x.webp'
    expect(deliveryUrl(deja)).toBe(deja)
  })

  it('laisse intacte une adresse qui n’est pas servie par l’hébergeur d’images', () => {
    // Le jeu de démonstration sert des SVG en local, par une adresse relative.
    // Une adresse d'un autre hôte n'est pas la nôtre à réécrire.
    for (const adresse of [
      '/seed/veste.svg',
      'https://exemple-inconnu.test/photo.jpg',
      'https://res.cloudinary.com/nina-diego/video/upload/v1/x.mp4',
      'http://res.cloudinary.com/nina-diego/image/upload/v1/x.webp',
      '',
    ]) {
      expect(deliveryUrl(adresse), adresse).toBe(adresse)
    }
  })

  it('est idempotente : la repasser ne change rien', () => {
    // Elle est appelée au rendu, sur une adresse qui vient de la base. Si un
    // jour une adresse déjà servie repassait par ici — un cache, une
    // recomposition — le résultat doit être le même.
    const une = deliveryUrl(ORIGINAL)
    expect(deliveryUrl(une)).toBe(une)
  })

  it('conserve la version et le chemin du fichier', () => {
    // La version est ce qui rend l'adresse immuable, donc cachable
    // indéfiniment. La perdre ferait servir une image obsolète après
    // remplacement.
    const servie = deliveryUrl(ORIGINAL)
    expect(servie).toContain('/v1712345678/')
    expect(servie).toContain('articles/veste-en-laine.webp')
  })

  it('reste dans le motif autorisé par next.config', () => {
    /**
     * Le garde-fou qui compte.
     *
     * `next.config.ts` restreint les images distantes au chemin
     * `/<compte>/image/upload/**`. Une adresse composée hors de ce motif est
     * refusée par l'optimiseur, qui répond 400 — et la page s'affiche avec un
     * trou, sans erreur de build, sans rien dans les journaux du site.
     *
     * La transformation s'insère APRÈS `/image/upload/`, donc dans la partie
     * couverte par `**`. Ce test le vérifie plutôt que de le supposer.
     */
    const servie = deliveryUrl(ORIGINAL)
    const motif = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/.+$/
    expect(servie).toMatch(motif)
  })
})
