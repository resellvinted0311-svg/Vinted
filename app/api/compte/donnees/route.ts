import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { exportPersonalData } from '@/lib/privacy/export'

/**
 * Copie des données personnelles — articles 15 et 20 du RGPD.
 *
 * Un vrai téléchargement plutôt qu'une Server Action : le navigateur enregistre
 * un fichier, la personne le garde, et le serveur n'a rien à faire transiter
 * par un état React. Un point d'entrée réseau de moins, aussi.
 *
 * L'identité vient de la SESSION. Cette route ne prend aucun paramètre : il
 * n'existe pas de façon de demander les données de quelqu'un d'autre.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser()

  // 404 plutôt que 401 : cette adresse n'a pas à confirmer son existence à qui
  // n'est pas connecté.
  if (!user) return new NextResponse(null, { status: 404 })

  // Un export relit toute la vie du compte. Le rejouer en boucle serait un
  // levier de déni de service commode : chemin sensible, donc fermé en cas de
  // panne du compteur.
  const allowed = await checkRateLimit({
    key: `privacy-export:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return new NextResponse(null, { status: 429 })

  const data = await exportPersonalData(user.id)
  if (!data) return new NextResponse(null, { status: 404 })

  const day = data.exportedAt.slice(0, 10)

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="donnees-personnelles-${day}.json"`,
      // Une copie de données personnelles ne se met en cache nulle part.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
