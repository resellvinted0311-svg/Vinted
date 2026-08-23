import 'server-only'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import sharp from 'sharp'
import { z } from 'zod'

import { prisma } from '@/lib/db/client'
import { getSetting } from '@/lib/config/settings'
import { storeImage } from '@/lib/providers/storage'
import { publishIfPending } from './articles'

/**
 * Téléchargement et réhébergement des visuels d'une pièce importée.
 *
 * Exécuté par la file de travaux, jamais pendant l'appel d'import : voir
 * `lib/sync/articles.ts` pour le pourquoi.
 *
 * ---------------------------------------------------------------------------
 * Ce module télécharge une URL FOURNIE PAR UN TIERS. C'est le point sensible.
 * ---------------------------------------------------------------------------
 * L'appelant est authentifié, mais une clé d'API se fuite, et une application
 * de gestion se fait compromettre. Une URL qu'on récupère telle quelle est la
 * définition d'une SSRF : le serveur va chercher, depuis l'intérieur du
 * réseau, ce que l'extérieur lui désigne.
 *
 * Trois barrières, dans cet ordre :
 *
 *  1. `https` seulement, et pas d'adresse IP littérale — vérifié à la
 *     validation (`lib/validation/sync.ts`) ;
 *  2. le nom est RÉSOLU ici, et toutes ses adresses doivent être publiques.
 *     C'est ce qui arrête `metadata.example.com` pointant sur
 *     169.254.169.254, l'adresse des métadonnées d'instance chez tous les
 *     hébergeurs — celle qui rend les identifiants du serveur ;
 *  3. le contenu est identifié sur ses OCTETS D'EN-TÊTE, jamais sur son
 *     extension ni sur le `Content-Type` annoncé, et un format hors liste
 *     n'atteint jamais le décodeur.
 *
 * Ce qui reste, et qu'il faut dire : entre la résolution et la connexion, un
 * serveur DNS hostile peut changer sa réponse — c'est le « DNS rebinding ».
 * S'en protéger vraiment demanderait d'ouvrir la connexion sur l'adresse
 * vérifiée en portant le nom dans l'en-tête `Host` et dans le SNI, ce que
 * `fetch` ne permet pas. La fenêtre est étroite et l'appelant est authentifié ;
 * la faille est connue, pas ignorée.
 */

// ---------------------------------------------------------------------------
// Bornes, telles que le contrat les annonce
// ---------------------------------------------------------------------------

/** 10 Mo par image. */
const MAX_BYTES = 10 * 1024 * 1024

/** 6000 × 6000 pixels au maximum. */
const MAX_DIMENSION = 6000

/**
 * 800 pixels minimum sur le grand côté.
 *
 * En dessous, une photo de vêtement ne montre ni la matière ni les coutures :
 * elle occupe la place d'une information sans en apporter.
 */
const MIN_LONG_SIDE = 800

/** Au-delà, l'hébergeur d'origine est considéré indisponible. */
const DOWNLOAD_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// 1. L'adresse est-elle publique ?
// ---------------------------------------------------------------------------

/**
 * Une adresse IPv4 privée, locale ou réservée.
 *
 * La liste vient des registres IANA. Les trois qui comptent vraiment ici :
 * 127/8 (la machine elle-même), 169.254/16 (métadonnées d'instance) et les
 * plages RFC 1918 (le réseau interne).
 */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true

  const [a = 0, b = 0, c = 0] = parts

  if (a === 0) return true // « cet hôte »
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // boucle locale
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT, RFC 6598
  if (a === 169 && b === 254) return true // lien-local et métadonnées
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 0 && c === 0) return true // protocoles IETF
  if (a === 192 && b === 0 && c === 2) return true // documentation
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return true // bancs d'essai
  if (a === 198 && b === 51 && c === 100) return true // documentation
  if (a === 203 && b === 0 && c === 113) return true // documentation
  if (a >= 224) return true // multidiffusion et réservé

  return false
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase()

  if (value === '::' || value === '::1') return true
  // Adresse IPv4 encapsulée : c'est la même machine cible, écrite autrement.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (mapped?.[1]) return isPrivateIPv4(mapped[1])

  const head = value.split(':')[0] ?? ''
  if (/^f[cd]/.test(head)) return true // local unique, fc00::/7
  if (/^fe[89ab]/.test(head)) return true // lien-local, fe80::/10
  if (head === 'ff00' || /^ff/.test(head)) return true // multidiffusion

  return false
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !isPrivateIPv4(address)
  if (family === 6) return !isPrivateIPv6(address)
  return false
}

/**
 * Refuse un nom d'hôte dont UNE SEULE adresse est privée.
 *
 * « Une seule » et non « toutes » : un nom qui résout vers une adresse publique
 * et une adresse interne servirait l'une ou l'autre selon l'ordre du résolveur,
 * et la moitié des tentatives atteindrait le réseau interne.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = await lookup(hostname, { all: true })

  if (addresses.length === 0) {
    throw new Error(`Nom introuvable : ${hostname}`)
  }

  for (const { address } of addresses) {
    if (!isPublicAddress(address)) {
      // L'adresse n'est PAS citée : elle décrit le réseau interne, et ce
      // message finit dans `Job.lastError`, donc potentiellement sous les yeux
      // de qui a fourni l'URL.
      throw new Error(`Adresse non publique refusée pour ${hostname}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Le contenu est-il vraiment une image, et de quel type ?
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

/**
 * Identifie le format sur les octets d'en-tête.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ne pas se contenter de `sharp`
 * ---------------------------------------------------------------------------
 * `sharp` sait déjà reconnaître un format sur ses octets. Mais il en reconnaît
 * BEAUCOUP — SVG, GIF, TIFF, PDF. Un SVG est un document XML, et le donner à
 * un décodeur pour découvrir ensuite qu'on n'en voulait pas, c'est l'avoir
 * décodé.
 *
 * Cette fonction est la porte : ce qu'elle ne nomme pas n'atteint jamais le
 * décodeur.
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null

  // JPEG : FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }

  // WebP : « RIFF » …4 octets de taille… « WEBP »
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }

  // AVIF : conteneur ISO-BMFF, « ftyp » en position 4, marque en position 8.
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }

  return null
}

// ---------------------------------------------------------------------------
// 3. Téléchargement borné
// ---------------------------------------------------------------------------

/**
 * Récupère les octets, en s'arrêtant net au-delà de la taille maximale.
 *
 * L'en-tête `Content-Length` est un INDICE, pas une garantie : il est fourni
 * par la même personne que le corps. On l'utilise pour renoncer tôt, et on
 * compte quand même les octets reçus.
 */
async function download(url: string): Promise<Buffer> {
  const parsed = new URL(url)
  await assertPublicHost(parsed.hostname)

  const response = await fetch(url, {
    // `manual` : une redirection est une seconde URL, qui n'a subi aucune de
    // nos vérifications. La suivre à l'aveugle rendrait la résolution DNS
    // ci-dessus purement décorative — il suffirait de servir un 302 vers
    // 169.254.169.254.
    redirect: 'manual',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    cache: 'no-store',
  })

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Redirection non suivie (${response.status}) : fournissez l’URL finale`,
    )
  }

  if (!response.ok) {
    throw new Error(`Téléchargement refusé (${response.status})`)
  }

  const announced = Number(response.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > MAX_BYTES) {
    throw new Error(
      `Image annoncée à ${announced} octets, au-delà de ${MAX_BYTES}`,
    )
  }

  const body = response.body
  if (!body) throw new Error('Réponse sans corps')

  const chunks: Uint8Array[] = []
  let total = 0

  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`Image au-delà de ${MAX_BYTES} octets`)
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------------------
// 4. Normalisation : orientation appliquée, métadonnées supprimées
// ---------------------------------------------------------------------------

export interface NormalizedImage {
  data: Buffer
  contentType: string
  width: number
  height: number
}

/**
 * Décode, redresse, ré-encode.
 *
 * ---------------------------------------------------------------------------
 * `rotate()` sans argument n'est pas décoratif
 * ---------------------------------------------------------------------------
 * Une photo de téléphone est presque toujours enregistrée dans le sens du
 * capteur, avec une balise EXIF « Orientation » qui dit comment la redresser.
 * Supprimer les métadonnées SANS appliquer cette balise publierait la moitié
 * du catalogue couché.
 *
 * `rotate()` applique l'orientation puis la retire. C'est l'ordre qui compte :
 * l'inverse perd l'information.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ré-encoder, et pourquoi en WebP
 * ---------------------------------------------------------------------------
 * Ré-encoder EST la suppression des métadonnées : `sharp` n'écrit ni EXIF, ni
 * IPTC, ni XMP sauf demande explicite. On ne fait donc pas de chirurgie sur
 * des segments — approche fragile, propre à chaque format — on repart des
 * pixels. Les coordonnées GPS du lieu de la photo, qui est souvent le domicile
 * du vendeur, ne survivent pas à l'opération.
 *
 * Un seul format en sortie, parce qu'un seul suffit : l'hébergeur dérive
 * ensuite les variantes que le navigateur accepte.
 */
export async function normalizeImage(buffer: Buffer): Promise<NormalizedImage> {
  const sniffed = sniffImageType(buffer)
  if (!sniffed || !ALLOWED_TYPES.has(sniffed)) {
    throw new Error(
      'Format non accepté : seuls JPEG, PNG, WebP et AVIF sont réhébergés',
    )
  }

  // `limitInputPixels` est le garde-fou contre la bombe à décompression : une
  // image de quelques kilo-octets peut se déplier en plusieurs gigaoctets de
  // mémoire, et la borne est appliquée PENDANT le décodage, pas après.
  const image = sharp(buffer, {
    limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
    animated: false,
  })

  const metadata = await image.metadata()

  // Les dimensions annoncées sont celles du capteur ; l'orientation EXIF peut
  // les échanger. On raisonne sur l'image REDRESSÉE, celle qui sera affichée.
  const turned = (metadata.orientation ?? 1) >= 5
  const width = (turned ? metadata.height : metadata.width) ?? 0
  const height = (turned ? metadata.width : metadata.height) ?? 0

  if (width <= 0 || height <= 0) {
    throw new Error('Dimensions illisibles')
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(
      `${width} × ${height} dépasse ${MAX_DIMENSION} × ${MAX_DIMENSION}`,
    )
  }
  if (Math.max(width, height) < MIN_LONG_SIDE) {
    throw new Error(
      `${width} × ${height} : le grand côté doit faire au moins ${MIN_LONG_SIDE} pixels`,
    )
  }

  const { data, info } = await image
    .rotate()
    .webp({ quality: 90, effort: 4 })
    .toBuffer({ resolveWithObject: true })

  return {
    data,
    contentType: 'image/webp',
    width: info.width,
    height: info.height,
  }
}

// ---------------------------------------------------------------------------
// Le travail différé
// ---------------------------------------------------------------------------

export const articleImagesPayload = z.object({
  articleId: z.string().min(1).max(64),
  urls: z.array(z.url()).min(1).max(10),
})

/**
 * Temps que le travail s'accorde pour aller chercher des visuels.
 *
 * Une fonction serverless a une durée maximale — `maxDuration` sur la route de
 * cron. Dix images chez un hébergeur lent la dépasseraient, et le processus
 * serait tué au milieu : le verrou du travail resterait posé un quart d'heure,
 * et rien n'aurait été écrit.
 *
 * On s'arrête donc AVANT, en gardant ce qui a été récupéré. Ce n'est pas une
 * limite de qualité, c'est une limite d'exécution.
 */
const JOB_BUDGET_MS = 30_000

export interface ArticleImagesReport {
  /** Visuels réhébergés à l'issue de ce passage, réutilisations comprises. */
  stored: number
  /** Récupérés pendant CE passage. */
  downloaded: number
  /** Tentés et échoués — adresse morte, format refusé, image trop petite. */
  failed: number
  /** Non tentés faute de temps : ils seront repris au passage suivant. */
  skipped: number
  published: boolean
}

/**
 * Télécharge, réhéberge et remplace les visuels d'une pièce.
 *
 * ---------------------------------------------------------------------------
 * Le travail PROGRESSE à chaque passage
 * ---------------------------------------------------------------------------
 * Un visuel déjà réhébergé sous la même URL d'origine n'est pas retéléchargé :
 * il est repris tel quel. C'est ce qui rend une reprise monotone.
 *
 * Sans cela, une pièce de dix images chez un hébergeur lent recommencerait de
 * zéro à chaque tentative, dépasserait de nouveau le temps imparti, et
 * épuiserait ses cinq essais sans jamais être publiée. Avec, chaque passage
 * avance : trois images, puis trois de plus, puis les quatre dernières.
 *
 * ---------------------------------------------------------------------------
 * Les anciens visuels ne sont retirés qu'à la toute fin
 * ---------------------------------------------------------------------------
 * Effacer d'abord laisserait une fiche PUBLIÉE sans photo pendant tout le
 * temps du téléchargement. On récupère, puis on échange en une transaction.
 *
 * ---------------------------------------------------------------------------
 * Ce qui empêche la publication, et ce qui ne l'empêche pas
 * ---------------------------------------------------------------------------
 *  - zéro visuel réhébergé : le travail LÈVE. Jamais de fiche publiée sans
 *    visuel, c'est la règle du contrat ;
 *  - des visuels non tentés faute de temps : le travail lève AUSSI, après
 *    avoir écrit ce qu'il a. La fiche ne se publie pas sur un jeu incomplet,
 *    et le passage suivant terminera le travail ;
 *  - des visuels tentés et définitivement en échec — adresse morte, image de
 *    400 pixels : ils n'empêchent rien. Attendre indéfiniment une photo qui
 *    n'existe pas laisserait la pièce invendue pour de bon.
 */
export async function fetchArticleImages(
  payload: unknown,
  budgetMs: number = JOB_BUDGET_MS,
): Promise<ArticleImagesReport | null> {
  const parsed = articleImagesPayload.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Charge utile invalide pour article.images')
  }

  const { articleId, urls } = parsed.data

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      sku: true,
      images: {
        orderBy: { position: 'asc' },
        select: { url: true, sourceUrl: true, width: true, height: true },
      },
      translations: {
        where: { locale: 'fr' },
        select: { title: true },
      },
    },
  })

  // Pièce disparue : rien à télécharger, et rien à réessayer.
  if (!article) return null

  const offersOpenAfterDays = await getSetting('offersOpenAfterDays')

  // Déjà exactement à jour : c'est le cas d'une reprise après un échec survenu
  // APRÈS les téléversements. On refait la publication, qui est idempotente,
  // sans rien réécrire.
  const upToDate =
    article.images.length === urls.length &&
    article.images.every((image, index) => image.sourceUrl === urls[index])

  if (upToDate) {
    const published = await prisma.$transaction((tx) =>
      publishIfPending(tx, article.id, offersOpenAfterDays),
    )
    return {
      stored: article.images.length,
      downloaded: 0,
      failed: 0,
      skipped: 0,
      published,
    }
  }

  // L'alternative textuelle est le titre de la fiche : c'est la description la
  // plus juste dont on dispose. Un numéro d'inventaire ne décrit rien, et une
  // alternative vide fait disparaître la pièce pour qui navigue à l'oreille.
  const alt = article.translations[0]?.title ?? null

  const alreadyStored = new Map(
    article.images.flatMap((image) =>
      image.sourceUrl ? [[image.sourceUrl, image] as const] : [],
    ),
  )

  const deadline = Date.now() + budgetMs

  const stored: {
    url: string
    sourceUrl: string
    width: number
    height: number
  }[] = []
  let downloaded = 0
  let failed = 0
  let skipped = 0

  for (const [index, url] of urls.entries()) {
    const reusable = alreadyStored.get(url)
    if (reusable) {
      stored.push({
        url: reusable.url,
        sourceUrl: url,
        width: reusable.width,
        height: reusable.height,
      })
      continue
    }

    if (Date.now() >= deadline) {
      skipped += 1
      continue
    }

    try {
      const normalized = await normalizeImage(await download(url))

      const result = await storeImage({
        data: normalized.data,
        contentType: normalized.contentType,
        folder: `articles/${article.sku}`,
        publicId: String(index + 1),
      })

      stored.push({
        url: result.url,
        sourceUrl: url,
        width: result.width,
        height: result.height,
      })
      downloaded += 1
    } catch (error) {
      failed += 1
      // Bruyant, mais sans l'URL complète : elle peut porter un jeton d'accès
      // dans sa chaîne de requête, et ce journal n'a pas à le conserver.
      console.error(
        `[sync] Visuel ${index + 1} de ${article.sku} en échec :`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  if (stored.length === 0) {
    throw new Error(
      `Aucun visuel récupéré pour ${article.sku} : la fiche reste en brouillon`,
    )
  }

  // Le jeu est-il complet ? Un visuel non tenté sera repris ; un visuel tenté
  // et perdu ne le sera pas, et la fiche ne l'attendra pas indéfiniment.
  const complete = skipped === 0

  const published = await prisma.$transaction(async (tx) => {
    await tx.articleImage.deleteMany({ where: { articleId: article.id } })

    for (const [position, image] of stored.entries()) {
      await tx.articleImage.create({
        data: {
          articleId: article.id,
          url: image.url,
          sourceUrl: image.sourceUrl,
          width: image.width,
          height: image.height,
          position,
          alt,
        },
      })
    }

    return complete
      ? publishIfPending(tx, article.id, offersOpenAfterDays)
      : false
  })

  if (!complete) {
    // L'écriture ci-dessus est COMMISE : le passage suivant repartira de là,
    // et non de zéro. Lever sert à remettre le travail en file, pas à annuler
    // ce qui vient d'être gagné.
    throw new Error(
      `${skipped} visuel(s) de ${article.sku} non traités dans le temps imparti : reprise au prochain passage`,
    )
  }

  return { stored: stored.length, downloaded, failed, skipped, published }
}
