import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import sharp from 'sharp'
import { prisma } from '@/lib/db/client'

/**
 * Le travail différé qui réhéberge les visuels, de bout en bout.
 *
 * Deux tiers sont simulés, et deux seulement : la résolution DNS et
 * l'hébergeur d'images. Tout le reste — décodage, bornes, suppression des
 * métadonnées, écriture en base, publication — est exercé pour de vrai.
 *
 * Ce qui se joue ici : une fiche n'est JAMAIS publiée sans visuel, et un
 * hébergeur indisponible dix minutes ne coûte pas la publication.
 */

const lookupMock = vi.hoisted(() => vi.fn())
const storeMock = vi.hoisted(() => vi.fn())

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

vi.mock('@/lib/providers/storage', () => ({
  isStorageConfigured: () => true,
  storeImage: storeMock,
  StorageNotConfiguredError: class extends Error {},
}))

const { fetchArticleImages } = await import('@/lib/sync/images')
const { loadSyncContext, syncArticle } = await import('@/lib/sync/articles')

const PREFIX = 'sync-img-'
const URLS = [
  'https://images.exemple.fr/a.jpg',
  'https://images.exemple.fr/b.jpg',
]

const PAYLOAD = {
  externalId: `${PREFIX}1`,
  title: 'Chemise en coton rayée',
  categorySlug: 'chemises',
  condition: 'VERY_GOOD',
  sizeLabel: 'L',
  priceCents: 3800,
  costCents: 900,
  weightGrams: 320,
  images: URLS,
}

let photo: Buffer

async function cleanup(): Promise<void> {
  await prisma.article.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  })
  await prisma.job.deleteMany({ where: { type: 'article.images' } })
}

/** Crée la pièce comme le ferait l'import, et renvoie son identifiant. */
async function createArticle(): Promise<string> {
  const context = await loadSyncContext()
  await syncArticle(PAYLOAD, 0, context, { dryRun: false })

  const article = await prisma.article.findUniqueOrThrow({
    where: { externalId: PAYLOAD.externalId },
    select: { id: true },
  })
  return article.id
}

beforeEach(async () => {
  await cleanup()

  photo = await sharp({
    create: {
      width: 1200,
      height: 1600,
      channels: 3,
      background: { r: 190, g: 175, b: 150 },
    },
  })
    // Des métadonnées bien présentes au départ : c'est ce qui rend le test de
    // suppression concluant plutôt que tautologique. IFD3 est le répertoire
    // GPS dans la nomenclature de libvips.
    .withExif({
      IFD0: { Copyright: 'Nina' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '50/1 38/1 0/1' },
    })
    .jpeg()
    .toBuffer()

  lookupMock.mockReset()
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

  storeMock.mockReset()
  storeMock.mockImplementation(
    (input: { publicId: string; folder: string }) => ({
      url: `https://res.cloudinary.test/${input.folder}/${input.publicId}.webp`,
      width: 1200,
      height: 1600,
      bytes: 1024,
    }),
  )

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(photo), { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(cleanup)

describe('réhébergement des visuels', () => {
  it('télécharge, réhéberge, écrit et publie', async () => {
    const articleId = await createArticle()

    const report = await fetchArticleImages({ articleId, urls: URLS })

    expect(report).toEqual({
      stored: 2,
      downloaded: 2,
      failed: 0,
      skipped: 0,
      published: true,
    })

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: {
        status: true,
        publishedAt: true,
        images: {
          orderBy: { position: 'asc' },
          select: { url: true, sourceUrl: true, alt: true, position: true },
        },
      },
    })

    expect(article.status).toBe('AVAILABLE')
    expect(article.publishedAt).not.toBeNull()

    expect(article.images).toHaveLength(2)
    // L'URL d'origine est conservée : c'est elle qui rend la resynchronisation
    // suivante capable de savoir que rien n'a changé.
    expect(article.images.map((image) => image.sourceUrl)).toEqual(URLS)
    expect(article.images[0]?.url).toContain('res.cloudinary.test')
    // L'alternative textuelle est le titre de la fiche : un numéro
    // d'inventaire ne décrit rien, et une alternative vide fait disparaître la
    // pièce pour qui navigue à l'oreille.
    expect(article.images[0]?.alt).toBe(PAYLOAD.title)
  })

  it('téléverse des octets sans métadonnées', async () => {
    const articleId = await createArticle()
    await fetchArticleImages({ articleId, urls: URLS })

    const uploaded = storeMock.mock.calls[0]?.[0] as {
      data: Buffer
      contentType: string
    }

    expect(uploaded.contentType).toBe('image/webp')

    // Les coordonnées GPS d'une photo de vêtement sont presque toujours celles
    // du domicile du vendeur. Elles ne doivent pas atteindre l'hébergeur.
    const metadata = await sharp(uploaded.data).metadata()
    expect(metadata.exif).toBeUndefined()
  })

  it('ne redemande rien quand les visuels sont déjà ceux demandés', async () => {
    const articleId = await createArticle()
    await fetchArticleImages({ articleId, urls: URLS })

    const downloadsBefore = vi.mocked(fetch).mock.calls.length
    const report = await fetchArticleImages({ articleId, urls: URLS })

    // C'est le cas d'une reprise après un échec survenu APRÈS les
    // téléversements : refaire la publication, oui ; retélécharger, non.
    expect(vi.mocked(fetch).mock.calls.length).toBe(downloadsBefore)
    expect(report?.stored).toBe(2)
  })

  it('garde les visuels récupérés quand une partie échoue', async () => {
    const articleId = await createArticle()

    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).endsWith('b.jpg')
        ? new Response('nope', { status: 404 })
        : new Response(new Uint8Array(photo), { status: 200 }),
    )

    const report = await fetchArticleImages({ articleId, urls: URLS })

    // Un visuel TENTÉ et définitivement perdu — adresse morte — n'empêche pas
    // la publication : attendre indéfiniment une photo qui n'existe pas
    // laisserait la pièce invendue pour de bon.
    expect(report).toEqual({
      stored: 1,
      downloaded: 1,
      failed: 1,
      skipped: 0,
      published: true,
    })
    expect(
      await prisma.articleImage.count({ where: { articleId } }),
    ).toBe(1)
  })

  it('garde ce qu’il a récupéré quand le temps manque, et ne publie pas', async () => {
    const articleId = await createArticle()

    // Budget nul : le premier visuel est déjà hors délai. Rien ne peut être
    // récupéré, donc rien n'est publié.
    await expect(
      fetchArticleImages({ articleId, urls: URLS }, 0),
    ).rejects.toThrow(/brouillon/)

    // Budget qui ne laisse passer que le premier : le second est NON TENTÉ.
    const slow = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return new Response(new Uint8Array(photo), { status: 200 })
    })
    vi.stubGlobal('fetch', slow)

    await expect(
      fetchArticleImages({ articleId, urls: URLS }, 50),
    ).rejects.toThrow(/temps imparti/)

    // L'écriture est COMMISE : le passage suivant repart de là, pas de zéro.
    const images = await prisma.articleImage.findMany({
      where: { articleId },
      select: { sourceUrl: true },
    })
    expect(images.map((image) => image.sourceUrl)).toEqual([URLS[0]])

    // Et la fiche n'est PAS publiée sur un jeu incomplet.
    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true },
    })
    expect(article.status).toBe('DRAFT')
  })

  it('reprend là où il s’est arrêté, sans retélécharger l’acquis', async () => {
    const articleId = await createArticle()

    // Premier passage : seul le premier visuel aboutit.
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).endsWith('b.jpg')
        ? new Response('nope', { status: 503 })
        : new Response(new Uint8Array(photo), { status: 200 }),
    )
    await fetchArticleImages({ articleId, urls: URLS })

    // Second passage : l'hébergeur répond de nouveau.
    vi.mocked(fetch).mockClear()
    vi.mocked(fetch).mockImplementation(
      async () => new Response(new Uint8Array(photo), { status: 200 }),
    )

    const report = await fetchArticleImages({ articleId, urls: URLS })

    // UN seul téléchargement : le visuel déjà réhébergé sous la même URL
    // d'origine est repris tel quel. Sans cette reprise, une pièce de dix
    // images chez un hébergeur lent recommencerait de zéro à chaque essai et
    // épuiserait ses cinq tentatives sans jamais être publiée.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    expect(report).toMatchObject({ stored: 2, downloaded: 1, skipped: 0 })

    const images = await prisma.articleImage.findMany({
      where: { articleId },
      orderBy: { position: 'asc' },
      select: { sourceUrl: true },
    })
    expect(images.map((image) => image.sourceUrl)).toEqual(URLS)
  })

  it('laisse la fiche en brouillon quand aucun visuel n’aboutit', async () => {
    const articleId = await createArticle()

    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 500 }))

    // Le travail LÈVE : la file le reprendra, et la fiche attend. Renvoyer un
    // succès publierait un vêtement sans photo.
    await expect(fetchArticleImages({ articleId, urls: URLS })).rejects.toThrow(
      /brouillon/,
    )

    const article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { status: true, publishedAt: true },
    })
    expect(article.status).toBe('DRAFT')
    expect(article.publishedAt).toBeNull()
  })

  it('ne va pas chercher une adresse non publique', async () => {
    const articleId = await createArticle()

    // Le nom est public, sa résolution ne l'est pas : c'est exactement la
    // forme d'une SSRF réussie contre les métadonnées d'instance.
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])

    await expect(fetchArticleImages({ articleId, urls: URLS })).rejects.toThrow(
      /brouillon/,
    )

    // Aucune requête n'est partie : la vérification précède le téléchargement.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('refuse un nom dont UNE seule adresse est privée', async () => {
    const articleId = await createArticle()

    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ])

    // Sinon la moitié des tentatives atteindrait le réseau interne, selon
    // l'ordre que le résolveur a choisi ce jour-là.
    await expect(fetchArticleImages({ articleId, urls: URLS })).rejects.toThrow()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('ne suit pas une redirection', async () => {
    const articleId = await createArticle()

    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest' },
      }),
    )

    // Une redirection est une seconde URL, qui n'a subi aucune vérification.
    // La suivre rendrait la résolution DNS purement décorative.
    await expect(fetchArticleImages({ articleId, urls: URLS })).rejects.toThrow()
    expect(await prisma.articleImage.count({ where: { articleId } })).toBe(0)
  })

  it('renonce sur une taille annoncée au-delà de la limite', async () => {
    const articleId = await createArticle()

    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array(photo), {
        status: 200,
        headers: { 'content-length': String(50 * 1024 * 1024) },
      }),
    )

    await expect(fetchArticleImages({ articleId, urls: URLS })).rejects.toThrow()
    expect(storeMock).not.toHaveBeenCalled()
  })

  it('ne réessaie pas pour une pièce effacée', async () => {
    const report = await fetchArticleImages({
      articleId: 'article-qui-n-existe-pas',
      urls: URLS,
    })

    // Réessayer cinq fois de télécharger les photos d'un article effacé ne le
    // fera pas réapparaître : le travail est terminé, pas en échec.
    expect(report).toBeNull()
  })

  it('refuse une charge utile qui n’est pas la sienne', async () => {
    await expect(fetchArticleImages({ articleId: '' })).rejects.toThrow(
      /Charge utile invalide/,
    )
  })
})
