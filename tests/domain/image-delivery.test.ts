import { describe, it, expect } from 'vitest'
import {
  deliveryUrl,
  isVideoUrl,
  videoPosterUrl,
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
    //
    // La vidéo ne figure PLUS dans cette liste, et c'est délibéré : le grand
    // visuel d'arrivée en accepte une depuis que la vitrine a été montée, donc
    // elle se transforme comme une image — même grammaire, même raison. La
    // laisser intacte servirait l'original en pleine définition sur la page la
    // plus vue du site. Le cas est couvert plus bas.
    for (const adresse of [
      '/seed/veste.svg',
      'https://exemple-inconnu.test/photo.jpg',
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

/**
 * La vidéo du grand visuel d'arrivée.
 *
 * ---------------------------------------------------------------------------
 * Ce que ces tests protègent
 * ---------------------------------------------------------------------------
 * La boutiquière colle UNE adresse dans un seul réglage, et la page en déduit
 * s'il faut poser une balise `img` ou une balise `video`. Se tromper de balise
 * ne lève rien : une vidéo dans un `img` laisse un cadre vide, et une image
 * dans un `video` aussi. C'est la panne muette dont ce projet a déjà souffert
 * deux fois — d'où une reconnaissance testée plutôt que supposée.
 */

const VIDEO =
  'https://res.cloudinary.com/nina-diego/video/upload/v1712345678/vitrine/atelier.mp4'

describe('la reconnaissance d’une vidéo', () => {
  it('distingue une vidéo d’une image au segment de RESSOURCE', () => {
    expect(isVideoUrl(VIDEO)).toBe(true)
    expect(isVideoUrl(ORIGINAL)).toBe(false)
  })

  it('ne se fie pas à l’extension', () => {
    // Cloudinary sert volontiers une vidéo sans suffixe, et une image peut
    // parfaitement s'appeler « .mp4.jpg ». L'extension ment ; le chemin, non.
    expect(
      isVideoUrl('https://res.cloudinary.com/nina-diego/video/upload/v1/vitrine/film'),
    ).toBe(true)
    expect(
      isVideoUrl('https://res.cloudinary.com/nina-diego/image/upload/v1/a/x.mp4.jpg'),
    ).toBe(false)
  })

  it('laisse tranquille ce qui n’est pas de l’hébergeur', () => {
    expect(isVideoUrl('https://exemple.fr/vitrine/atelier.mp4')).toBe(false)
    expect(isVideoUrl('/seed/veste.svg')).toBe(false)
  })

  it('transforme une vidéo comme une image', () => {
    // Même grammaire, même raison : borner la source et laisser l'hébergeur
    // choisir le format. Un motif qui n'accepterait que « /image/upload/ »
    // renverrait la vidéo intacte, donc l'original en pleine définition.
    expect(deliveryUrl(VIDEO)).toBe(
      `https://res.cloudinary.com/nina-diego/video/upload/f_auto,q_auto,c_limit,w_${MAX_DELIVERY_WIDTH}/v1712345678/vitrine/atelier.mp4`,
    )
  })
})

describe('l’affiche d’une vidéo', () => {
  it('réclame la première image, en JPEG', () => {
    expect(videoPosterUrl(VIDEO)).toBe(
      `https://res.cloudinary.com/nina-diego/video/upload/so_0,f_auto,q_auto,c_limit,w_${MAX_DELIVERY_WIDTH}/v1712345678/vitrine/atelier.jpg`,
    )
  })

  it('REMPLACE l’extension au lieu de l’ajouter', () => {
    // « atelier.mp4.jpg » ne désigne aucun fichier chez l'hébergeur : le
    // navigateur recevrait un 404 et peindrait un cadre noir le temps du
    // chargement de la vidéo.
    expect(videoPosterUrl(VIDEO)).not.toContain('.mp4.jpg')
  })

  it('n’invente pas d’affiche pour une image', () => {
    // Une image n'en a pas besoin, et fabriquer une adresse plausible mais
    // fausse vaut moins que ne rien poser du tout.
    expect(videoPosterUrl(ORIGINAL)).toBeNull()
    expect(videoPosterUrl('https://exemple.fr/film.mp4')).toBeNull()
  })
})
