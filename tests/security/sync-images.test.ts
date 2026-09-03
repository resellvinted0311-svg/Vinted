import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { isPublicAddress, normalizeImage, sniffImageType } from '@/lib/sync/images'

/**
 * Les trois barrières du réhébergement des visuels.
 *
 * Ce module va chercher, sur le réseau, une adresse fournie par un tiers, et
 * donne ce qu'il rapporte à un décodeur d'images. C'est le point le plus
 * exposé de tout l'import ; il est donc testé sur ce qu'il REFUSE, pas
 * seulement sur ce qu'il accepte.
 */

// ---------------------------------------------------------------------------
// Fixtures — de vraies images, encodées à la volée
// ---------------------------------------------------------------------------

function canvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 180, b: 150 },
    },
  })
}

const jpeg = (w = 1200, h = 900) => canvas(w, h).jpeg().toBuffer()
const png = (w = 1200, h = 900) => canvas(w, h).png().toBuffer()
const webp = (w = 1200, h = 900) => canvas(w, h).webp().toBuffer()

// ---------------------------------------------------------------------------
// 1. Le type réel, sur les octets d'en-tête
// ---------------------------------------------------------------------------

describe('identification du format', () => {
  it('reconnaît les quatre formats réhébergés', async () => {
    expect(sniffImageType(await jpeg())).toBe('image/jpeg')
    expect(sniffImageType(await png())).toBe('image/png')
    expect(sniffImageType(await webp())).toBe('image/webp')
  })

  it('refuse un SVG, qui est un document, pas une photo', () => {
    // Le cas qui compte : un SVG est du XML, et le donner au décodeur pour
    // s'apercevoir ensuite qu'on n'en voulait pas, c'est l'avoir décodé.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    )
    expect(sniffImageType(svg)).toBeNull()
  })

  it('refuse un GIF et un TIFF, que le décodeur saurait pourtant lire', () => {
    const gif = Buffer.from('GIF89a' + '\0'.repeat(20), 'latin1')
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, ...Array(20).fill(0)])

    expect(sniffImageType(gif)).toBeNull()
    expect(sniffImageType(tiff)).toBeNull()
  })

  it('refuse un exécutable renommé en .jpg', () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Array(20).fill(0)])
    expect(sniffImageType(elf)).toBeNull()
  })

  it('refuse un contenu trop court pour porter un en-tête', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull()
  })

  it('ne se fie pas au début d’un JPEG pour valider un WebP', () => {
    // « RIFF » sans « WEBP » en position 8 : un WAV, par exemple.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'latin1'),
      Buffer.alloc(16),
    ])
    expect(sniffImageType(wav)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. L'adresse est-elle publique ?
// ---------------------------------------------------------------------------

describe('adresses refusées', () => {
  it('refuse la machine elle-même', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('127.53.1.9')).toBe(false)
    expect(isPublicAddress('0.0.0.0')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('::')).toBe(false)
  })

  it('refuse les métadonnées d’instance', () => {
    // 169.254.169.254 rend les identifiants du serveur chez tous les
    // hébergeurs. C'est la cible numéro un d'une SSRF, et elle a un nom.
    expect(isPublicAddress('169.254.169.254')).toBe(false)
    expect(isPublicAddress('169.254.0.1')).toBe(false)
  })

  it('refuse les réseaux privés', () => {
    expect(isPublicAddress('10.0.0.1')).toBe(false)
    expect(isPublicAddress('172.16.0.1')).toBe(false)
    expect(isPublicAddress('172.31.255.254')).toBe(false)
    expect(isPublicAddress('192.168.1.1')).toBe(false)
    expect(isPublicAddress('100.64.0.1')).toBe(false)
  })

  it('refuse une adresse IPv4 déguisée en IPv6', () => {
    // Même machine cible, écrite autrement : sans ce cas, la liste IPv4
    // entière se contournerait en préfixant `::ffff:`.
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false)
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false)
  })

  it('refuse les plages IPv6 locales', () => {
    expect(isPublicAddress('fc00::1')).toBe(false)
    expect(isPublicAddress('fd12:3456::1')).toBe(false)
    expect(isPublicAddress('fe80::1')).toBe(false)
  })

  it('refuse les AUTRES écritures de la même machine', () => {
    // Une seule forme était reconnue — la mixte compressée, testée juste
    // au-dessus. La même adresse s'écrit pourtant de plusieurs façons, et un
    // contrôle qui n'en connaît qu'une ne contrôle rien.
    //
    // La plus dangereuse est la troisième : c'est l'adresse des métadonnées
    // d'instance, celle qui rend les identifiants du serveur, écrite sous une
    // forme que la liste ne regardait pas.
    expect(isPublicAddress('::127.0.0.1')).toBe(false) // compatible IPv4
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false) // mappée, hexadécimal
    expect(isPublicAddress('0:0:0:0:0:ffff:169.254.169.254')).toBe(false)
    expect(isPublicAddress('::7f00:1')).toBe(false) // compatible, hexadécimal
  })

  it('refuse les mécanismes de traduction vers IPv4', () => {
    // NAT64 et 6to4 ne sont pas des écritures mais des passerelles : si le
    // réseau en porte une, l'adresse mène bien à l'IPv4 encapsulée. On refuse
    // le mécanisme plutôt que de parier sur la configuration de l'hôte.
    expect(isPublicAddress('64:ff9b::a9fe:a9fe')).toBe(false) // NAT64
    expect(isPublicAddress('2002:7f00:1::')).toBe(false) // 6to4
  })

  it('refuse ce qui n’est pas une adresse', () => {
    expect(isPublicAddress('exemple.fr')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
    expect(isPublicAddress('999.1.1.1')).toBe(false)
  })

  it('accepte les adresses réellement publiques', () => {
    // Sans ce test, un `return false` inconditionnel rendrait tous les autres
    // verts, et le réhébergement ne fonctionnerait jamais.
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('172.32.0.1')).toBe(true)
    // Et en IPv6 : les refus ci-dessus ne doivent pas fermer la porte à tout.
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    expect(isPublicAddress('2a00:1450:4007:80f::200e')).toBe(true)
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Normalisation : orientation appliquée, métadonnées supprimées
// ---------------------------------------------------------------------------

describe('normalisation', () => {
  it('supprime les métadonnées, y compris les coordonnées du lieu', async () => {
    const source = await canvas(1200, 900)
      .withExif({
        IFD0: { Copyright: 'Nina', Software: 'Appareil de test' },
        // IFD3 est le répertoire GPS dans la nomenclature de libvips. C'est là
        // que se rangent les coordonnées du lieu de la photo — presque toujours
        // le domicile du vendeur.
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '50/1 38/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '3/1 3/1 0/1',
        },
      })
      .jpeg()
      .toBuffer()

    // La photo de départ porte bien des métadonnées : sans cette assertion, le
    // test passerait aussi sur une image qui n'en a jamais eu.
    const before = await sharp(source).metadata()
    expect(before.exif).toBeDefined()
    expect(before.exif?.toString('latin1')).toContain('Nina')

    const normalized = await normalizeImage(source)
    const after = await sharp(normalized.data).metadata()

    expect(after.exif).toBeUndefined()
    // Et rien n'en subsiste dans les octets : le ré-encodage repart des pixels,
    // il ne fait pas de chirurgie sur des segments.
    expect(normalized.data.toString('latin1')).not.toContain('Nina')
  })

  it('applique l’orientation AVANT de la supprimer', async () => {
    // Le piège : effacer l'EXIF sans appliquer la balise d'orientation
    // publierait la moitié des photos de téléphone couchées.
    const source = await canvas(1200, 900)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    expect((await sharp(source).metadata()).orientation).toBe(6)

    const normalized = await normalizeImage(source)

    // 6 = quart de tour : les côtés s'échangent.
    expect(normalized.width).toBe(900)
    expect(normalized.height).toBe(1200)
    expect((await sharp(normalized.data).metadata()).orientation).toBeUndefined()
  })

  it('conserve les dimensions d’une image droite', async () => {
    const normalized = await normalizeImage(await jpeg(1200, 1600))
    expect(normalized.width).toBe(1200)
    expect(normalized.height).toBe(1600)
    expect(normalized.contentType).toBe('image/webp')
  })

  it('refuse une image trop petite pour montrer une matière', async () => {
    await expect(normalizeImage(await jpeg(640, 480))).rejects.toThrow(
      /800 pixels/,
    )
  })

  it('accepte tout juste 800 pixels sur le grand côté', async () => {
    const normalized = await normalizeImage(await jpeg(800, 600))
    expect(normalized.width).toBe(800)
  })

  it('refuse une image au-delà de 6000 pixels', async () => {
    await expect(normalizeImage(await png(6001, 100))).rejects.toThrow(
      /6000/,
    )
  })

  it('refuse un format hors liste sans le décoder', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900"/></svg>',
    )
    await expect(normalizeImage(svg)).rejects.toThrow(/Format non accepté/)
  })
})

// ---------------------------------------------------------------------------
// 4. La miniature d'attente
// ---------------------------------------------------------------------------

describe('miniature d’attente', () => {
  /**
   * `ArticleImage.blurhash` était LU et jamais ÉCRIT.
   *
   * Le composant image alimente `placeholder="blur"` et `blurDataURL` avec
   * cette colonne. Elle était nulle sur toutes les lignes, donc `placeholder`
   * retombait sur `empty` : du code mort, et chaque vignette qui apparaît d'un
   * coup sur un aplat de couleur.
   *
   * Le nom de la colonne dit « blurhash », mais `blurDataURL` attend une
   * ADRESSE `data:`. Y ranger un vrai condensé BlurHash produirait une adresse
   * invalide, et le navigateur afficherait un cadre cassé pendant tout le
   * chargement. Ces tests vérifient donc la FORME autant que la présence.
   */
  it('est une adresse `data:` que le navigateur sait afficher', async () => {
    const normalized = await normalizeImage(await jpeg(1200, 1600))

    expect(normalized.placeholder).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/)

    // Et elle décode bien en une image : une chaîne base64 valide qui ne
    // serait pas une image passerait l'expression régulière ci-dessus.
    const octets = Buffer.from(
      normalized.placeholder.split(',')[1] as string,
      'base64',
    )
    const meta = await sharp(octets).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(16)
  })

  it('reste assez légère pour être inlinée trente fois dans une page', async () => {
    /**
     * Elle voyage DANS le HTML, une fois par vignette. Une grille de catalogue
     * en porte trente ; la vitrine, huit de plus.
     *
     * La borne est large — mille cinq cents caractères — parce qu'elle ne sert
     * pas à optimiser mais à attraper une erreur d'ordre de grandeur : une
     * miniature produite à cent-vingt-huit pixels au lieu de seize, ou en PNG
     * au lieu de WebP, pèserait dix fois plus et alourdirait de plusieurs
     * dizaines de kilo-octets la page qu'elle est censée rendre plus agréable.
     */
    const normalized = await normalizeImage(await jpeg(2400, 3200))
    expect(normalized.placeholder.length).toBeLessThan(1500)
  })

  it('suit l’orientation de la photo, comme le visuel lui-même', async () => {
    // Elle est dérivée de la sortie NORMALISÉE, donc déjà redressée. Dérivée
    // de l'original, elle serait couchée sous une photo debout — un défaut qui
    // ne dure qu'un instant, et qui ne se voit donc pas sur une capture.
    const source = await canvas(1200, 900)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const normalized = await normalizeImage(source)
    const octets = Buffer.from(
      normalized.placeholder.split(',')[1] as string,
      'base64',
    )
    const meta = await sharp(octets).metadata()

    // La photo redressée est en portrait : la miniature aussi.
    expect(meta.width).toBe(16)
    expect(meta.height).toBeGreaterThan(meta.width!)
  })
})
