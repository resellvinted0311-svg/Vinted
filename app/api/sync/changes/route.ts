import { NextResponse, type NextRequest } from 'next/server'

import { checkRateLimit } from '@/lib/security/rate-limit'
import { authenticateSync } from '@/lib/sync/auth'
import { CHANGES_PAGE_SIZE, readSyncChanges } from '@/lib/sync/changes'

/**
 * Rattrapage d'inventaire — `docs/synchronisation.md`, §3.6.
 *
 * L'application de gestion appelle ici quand elle a manqué des appels signés :
 * arrêt prolongé, secret expiré, adresse changée. Elle repart d'une date et
 * remonte le fil jusqu'à aujourd'hui.
 *
 * ---------------------------------------------------------------------------
 * Même clé que l'import, et pourquoi
 * ---------------------------------------------------------------------------
 * `SYNC_API_KEY` protège les deux sens. Un second secret pour la lecture
 * n'ajouterait rien : le même correspondant, la même confiance, et un secret de
 * plus à faire tourner est un secret de plus à oublier.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Plus généreux que l'import : cette route ne fait que LIRE.
 *
 * Un rattrapage d'une semaine se pagine, et l'application enchaînera les pages
 * sans raison de s'espacer. Trente appels par minute suffiraient à peine à six
 * mille pièces.
 */
const RATE_LIMIT = 120
const RATE_WINDOW_SECONDS = 60

function errorResponse(
  status: number,
  reason: string,
  detail: string,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json({ ok: false, reason, detail }, { status, headers })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const caller = authenticateSync(request.headers.get('authorization'))
  if (!caller) {
    return errorResponse(
      401,
      'unauthorized',
      'clé de synchronisation absente ou invalide',
    )
  }

  // Chemin de LECTURE : `sensitive: false`. Une panne du compteur ne doit pas
  // empêcher un rattrapage — c'est précisément le mécanisme qui répare les
  // pannes, et le fermer aggraverait l'incident qu'il sert à réparer.
  const allowed = await checkRateLimit({
    key: `sync:changes:${caller.counterKey}`,
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
    sensitive: false,
  })

  if (!allowed) {
    return errorResponse(
      429,
      'rate-limited',
      `au-delà de ${RATE_LIMIT} appels par minute`,
      { 'Retry-After': String(RATE_WINDOW_SECONDS) },
    )
  }

  const raw = request.nextUrl.searchParams.get('since')
  if (!raw) {
    return errorResponse(
      400,
      'invalid-field',
      'since est obligatoire, au format ISO 8601',
    )
  }

  const since = new Date(raw)
  if (Number.isNaN(since.getTime())) {
    return errorResponse(
      400,
      'invalid-field',
      `since n’est pas une date lisible : ${raw.slice(0, 40)}`,
    )
  }

  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = limitParam ? Number(limitParam) : undefined
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > CHANGES_PAGE_SIZE)
  ) {
    return errorResponse(
      400,
      'invalid-field',
      `limit doit être un entier entre 1 et ${CHANGES_PAGE_SIZE}`,
    )
  }

  const page = await readSyncChanges({
    since,
    afterExternalId: request.nextUrl.searchParams.get('after') ?? undefined,
    limit,
  })

  return NextResponse.json(
    { ok: true, since: since.toISOString(), ...page },
    {
      headers: {
        // Un état d'inventaire ne se met jamais en cache : c'est précisément
        // ce qui change.
        'Cache-Control': 'no-store',
      },
    },
  )
}
