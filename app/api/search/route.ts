import { NextResponse, type NextRequest } from 'next/server'
import { suggest } from '@/lib/db/queries/search'
import { autocompleteSchema } from '@/lib/validation/catalogue'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Autocomplétion de recherche.
 *
 * En lecture seule et sans effet de bord, donc exposée en GET. La limitation
 * de débit est indispensable : chaque frappe déclenche potentiellement une
 * requête plein texte.
 */
export async function GET(request: NextRequest) {
  const allowed = await checkRateLimit({
    key: `search:${await clientFingerprint()}`,
    limit: 60,
    windowSeconds: 60,
    // Confort : bloquer la recherche pendant une panne punirait des clientes
    // pour rien.
    sensitive: false,
  })
  if (!allowed) {
    return NextResponse.json(
      { suggestions: [] },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const parsed = autocompleteSchema.safeParse({
    q: request.nextUrl.searchParams.get('q') ?? '',
    locale: request.nextUrl.searchParams.get('locale') ?? 'fr',
  })

  if (!parsed.success) {
    return NextResponse.json(
      { suggestions: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const suggestions = await suggest(parsed.data.q, parsed.data.locale)

  return NextResponse.json(
    { suggestions },
    {
      headers: {
        // Court mais non nul : deux frappes rapprochées sur la même chaîne
        // ne repartent pas en base.
        'Cache-Control': 'private, max-age=15',
      },
    },
  )
}
