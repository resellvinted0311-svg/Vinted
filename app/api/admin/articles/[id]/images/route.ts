import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin, AuthorizationError } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { addArticleImage } from '@/lib/articles/images'
import { logger } from '@/lib/observability/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Téléversement d'une photo de pièce.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une route et non une Server Action
 * ---------------------------------------------------------------------------
 * Les Server Actions de Next plafonnent le corps de la requête à un mégaoctet,
 * et ce plafond est GLOBAL : le relever pour accepter une photo de téléphone le
 * relèverait aussi pour toutes les actions publiques du site — panier, offres,
 * tunnel de commande. Une borne de sécurité qu'on desserre pour un besoin
 * précis ne devrait jamais se desserrer ailleurs.
 *
 * Une route porte sa propre limite. Les actions restent à un mégaoctet.
 *
 * ---------------------------------------------------------------------------
 * Le rôle est vérifié ICI, pas seulement au routage
 * ---------------------------------------------------------------------------
 * Le middleware filtre `/admin`, pas `/api/admin` — et de toute façon il ne
 * peut pas interroger la base depuis l'Edge. Sans ce contrôle, n'importe qui
 * déposerait des fichiers dans l'espace de stockage de la boutique.
 */

/**
 * Au-delà, on refuse sans lire.
 *
 * `normalizeImage` a sa propre borne à dix mégaoctets, appliquée aux octets
 * décodés. Celle-ci est en amont : elle évite de porter en mémoire un corps
 * qu'on rejettera de toute façon.
 */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let adminId: string
  try {
    const admin = await requireAdmin()
    adminId = admin.id
  } catch (error) {
    // 404 et non 403 : confirmer l'existence d'une régie à cette adresse
    // renseignerait qui n'y a pas droit. Rôle insuffisant OU session absente : 404 dans les deux cas. Distinguer
    // « connectez-vous » de « vous n'avez pas le droit » apprendrait déjà
    // qu'il y a quelque chose ici.
    if (error instanceof AuthorizationError) {
      return new NextResponse(null, { status: 404 })
    }
    if (error instanceof Error && /session|authenticat/i.test(error.name)) {
      return new NextResponse(null, { status: 404 })
    }
    throw error
  }

  const allowed = await checkRateLimit({
    key: `article-image-upload:${adminId}`,
    limit: 200,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) {
    return NextResponse.json({ error: 'rateLimited' }, { status: 429 })
  }

  const { id } = await params

  const announced = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(announced) && announced > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'tooLarge' }, { status: 413 })
  }

  let file: unknown
  try {
    const form = await request.formData()
    file = form.get('image')
  } catch {
    return NextResponse.json({ error: 'invalidRequest' }, { status: 400 })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'invalidRequest' }, { status: 400 })
  }

  // Deuxième borne, sur la taille RÉELLE : l'en-tête annoncé n'engage que
  // celui qui l'écrit.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'tooLarge' }, { status: 413 })
  }

  const data = Buffer.from(await file.arrayBuffer())

  const result = await addArticleImage(id, data)

  if (!result.ok) {
    // Le motif de refus part à l'écran : « refusé » sans raison laisse
    // rééssayer la même photo indéfiniment. Il ne porte aucune donnée
    // personnelle — c'est un message technique sur un format d'image.
    logger.info('admin.article_image.rejected', {
      articleId: id,
      reason: result.reason,
    })

    const status = result.reason === 'not-found' ? 404 : 400
    return NextResponse.json(
      { error: result.reason, detail: result.detail ?? null },
      { status },
    )
  }

  return NextResponse.json({
    imageId: result.imageId,
    url: result.url,
    position: result.position,
  })
}
