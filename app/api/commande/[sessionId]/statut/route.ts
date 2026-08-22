import { NextResponse } from 'next/server'
import { publicJson } from '@/lib/security/public-json'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { readCartOwner } from '@/lib/shop/cart'
import { getOrderByCheckoutSession } from '@/lib/db/queries/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * État de règlement d'une commande, pour la page de retour de paiement.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette adresse existe
 * ---------------------------------------------------------------------------
 * La redirection du navigateur et l'appel de Stripe à notre webhook partent en
 * même temps. La page de retour peut donc s'afficher AVANT que la commande
 * soit marquée payée. Sans cette sonde, la personne resterait devant
 * « paiement en cours de confirmation » jusqu'à ce qu'elle recharge d'
 * elle-même — au moment précis où elle a le plus besoin d'être rassurée.
 *
 * ---------------------------------------------------------------------------
 * Elle NE MARQUE RIEN
 * ---------------------------------------------------------------------------
 * Elle lit. Seul le webhook signé décide qu'une commande est payée : cette
 * adresse est joignable par n'importe qui, à la main, en boucle.
 *
 * ---------------------------------------------------------------------------
 * Elle ne renvoie qu'un mot
 * ---------------------------------------------------------------------------
 * L'état, et rien d'autre. Pas de montant, pas d'adresse, pas de numéro de
 * commande : la page qui interroge a déjà tout cela, rendue côté serveur avec
 * la portée du propriétaire. Ajouter des données ici serait ouvrir une seconde
 * porte, plus discrète, sur les mêmes informations.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const allowed = await checkRateLimit({
    key: `order-status:${await clientFingerprint()}`,
    limit: 60,
    windowSeconds: 60,
    sensitive: false,
  })
  if (!allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const { sessionId } = await params
  const owner = await readCartOwner()

  // Sans propriétaire identifiable, il n'y a rien à dire. On ne distingue pas
  // ce cas d'une commande introuvable : la nuance n'apporterait qu'un moyen de
  // tester des identifiants.
  const order = owner ? await getOrderByCheckoutSession(owner, sessionId) : null

  const state = !order
    ? ('unknown' as const)
    : order.status === 'PENDING_PAYMENT'
      ? ('pending' as const)
      : order.status === 'CANCELLED'
        ? ('cancelled' as const)
        : ('paid' as const)

  return publicJson(
    { state },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    },
  )
}
