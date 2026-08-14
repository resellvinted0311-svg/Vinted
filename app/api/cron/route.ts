import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { releaseExpiredStockLocks } from '@/lib/shop/stock-lock'

/**
 * Travaux périodiques.
 *
 * Appelée par Vercel Cron selon la planification de `vercel.json`. Aucune autre
 * route ne déclenche ces travaux : ils modifient du stock, et doivent avoir un
 * seul point d'entrée, contrôlé.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un secret, et pourquoi une comparaison à temps constant
 * ---------------------------------------------------------------------------
 * Sans secret, n'importe qui pourrait déclencher la libération des
 * réservations en boucle et faire tomber des paiements en cours. Vercel envoie
 * `Authorization: Bearer <CRON_SECRET>` ; on le vérifie sans jamais court-
 * circuiter la comparaison au premier octet différent, ce qui laisserait
 * deviner le secret caractère par caractère.
 *
 * Sans `CRON_SECRET` configuré, la route REFUSE tout : une porte ouverte par
 * défaut sur du stock ne se rattrape pas.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  // `timingSafeEqual` exige des longueurs égales : on les compare d'abord,
  // ce qui ne divulgue que la longueur du secret — sans intérêt pour qui
  // cherche à le deviner.
  const given = Buffer.from(header)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false

  return timingSafeEqual(given, wanted)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    // 404 plutôt que 401 : inutile de confirmer l'existence de la route à qui
    // n'a pas le secret.
    return new NextResponse(null, { status: 404 })
  }

  const startedAt = Date.now()

  // Les travaux sont indépendants : l'échec de l'un ne doit pas empêcher les
  // autres. On les exécutera en parallèle à mesure qu'ils s'ajoutent.
  const releasedLocks = await releaseExpiredStockLocks()

  return NextResponse.json({
    ok: true,
    releasedLocks,
    durationMs: Date.now() - startedAt,
  })
}
