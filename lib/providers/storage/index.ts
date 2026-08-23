import 'server-only'

import { createHash } from 'node:crypto'

/**
 * Réhébergement des visuels.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi réhéberger plutôt que pointer sur l'URL d'origine
 * ---------------------------------------------------------------------------
 * Une fiche qui pointe vers l'hébergeur de l'application de gestion devient
 * vide le jour où celui-ci fait le ménage, change de chemin ou expire un jeton
 * — et ce jour-là, personne ne l'apprend : la fiche reste en ligne, en vente,
 * sans photo.
 *
 * Le contrat le dit à l'application (`docs/synchronisation.md`, §2.7) : « vos
 * URL peuvent disparaître ensuite sans casser la fiche ». Cette promesse ne
 * tient que si les octets sont recopiés.
 *
 * ---------------------------------------------------------------------------
 * Sans configuration, on ÉCHOUE — on ne se rabat sur rien
 * ---------------------------------------------------------------------------
 * La tentation serait d'écrire l'URL d'origine dans `ArticleImage.url` quand
 * Cloudinary n'est pas configuré. Ce serait publier une fiche dont les visuels
 * dépendent d'un tiers, exactement ce que le réhébergement existe pour éviter,
 * et sans que rien ne le signale.
 *
 * Le travail échoue donc, la fiche reste en brouillon, et l'échec est visible
 * dans la file. Un catalogue qui manque une pièce se répare ; un catalogue qui
 * publie des fiches dont les photos vont disparaître ne se répare pas, parce
 * qu'on ne sait pas lesquelles.
 */

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Hébergement d’images non configuré : renseignez CLOUDINARY_CLOUD_NAME, ' +
        'CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET.',
    )
    this.name = 'StorageNotConfiguredError'
  }
}

interface CloudinaryCredentials {
  cloudName: string
  apiKey: string
  apiSecret: string
}

function credentials(): CloudinaryCredentials | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

export function isStorageConfigured(): boolean {
  return credentials() !== null
}

export interface StoredImage {
  /** URL publique définitive, servie par l'hébergeur. */
  url: string
  width: number
  height: number
  bytes: number
}

export interface StoreImageInput {
  data: Buffer
  /** Type MIME RÉEL, déduit des octets d'en-tête — jamais de l'extension. */
  contentType: string
  /** Dossier de rangement, ex. `articles/ART-000051`. */
  folder: string
  /** Nom stable dans ce dossier, ex. `1`. */
  publicId: string
}

/**
 * Signature Cloudinary.
 *
 * SHA-1 des paramètres SIGNÉS, triés par nom, concaténés en `k=v&k=v`, suivis
 * du secret. `file` et `api_key` n'entrent pas dans la signature — c'est la
 * règle de Cloudinary, pas un oubli.
 *
 * SHA-1 n'est pas un choix : c'est l'algorithme imposé par leur API. Il n'a
 * ici aucun rôle de résistance aux collisions — il authentifie un appel sortant
 * dont nous fabriquons nous-mêmes le contenu.
 */
function sign(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex')
}

/** Au-delà, on considère l'hébergeur indisponible et le travail échoue. */
const UPLOAD_TIMEOUT_MS = 30_000

export async function storeImage(input: StoreImageInput): Promise<StoredImage> {
  const creds = credentials()
  if (!creds) throw new StorageNotConfiguredError()

  // Horodatage en secondes : Cloudinary refuse un appel trop ancien, ce qui
  // borne la réutilisation d'une signature interceptée.
  const timestamp = String(Math.floor(Date.now() / 1000))

  const signed: Record<string, string> = {
    folder: input.folder,
    public_id: input.publicId,
    timestamp,
    // Le rejeu d'un même import ne doit pas empiler des copies : à chemin
    // égal, on remplace.
    overwrite: 'true',
    invalidate: 'true',
  }

  const form = new FormData()
  for (const [key, value] of Object.entries(signed)) form.append(key, value)
  form.append('api_key', creds.apiKey)
  form.append('signature', sign(signed, creds.apiSecret))
  form.append(
    'file',
    new Blob([new Uint8Array(input.data)], { type: input.contentType }),
    input.publicId,
  )

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`,
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    // Le corps d'erreur de Cloudinary cite le nom du dossier et le code, jamais
    // le secret. On le tronque quand même : un message d'erreur de plusieurs
    // kilo-octets noierait le journal sans rien apprendre.
    const body = await response.text().catch(() => '')
    throw new Error(
      `Hébergement d’images : ${response.status} ${body.slice(0, 300)}`,
    )
  }

  const payload = (await response.json()) as {
    secure_url?: unknown
    width?: unknown
    height?: unknown
    bytes?: unknown
  }

  if (
    typeof payload.secure_url !== 'string' ||
    typeof payload.width !== 'number' ||
    typeof payload.height !== 'number'
  ) {
    throw new Error('Hébergement d’images : réponse inattendue.')
  }

  return {
    url: payload.secure_url,
    width: payload.width,
    height: payload.height,
    bytes: typeof payload.bytes === 'number' ? payload.bytes : input.data.length,
  }
}
