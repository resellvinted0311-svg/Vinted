import { NextResponse } from 'next/server'
import { publicJson } from '@/lib/security/public-json'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { getCurrentUser } from '@/lib/auth/session'
import { readCartCount } from '@/lib/shop/cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * État de session, pour l'en-tête.
 *
 * Les pages publiques (accueil, catalogue, fiche article) doivent rester
 * rendues statiquement : ce sont elles qui portent le référencement et les
 * cibles Core Web Vitals. Lire la session dans leur arbre de rendu les
 * rendrait toutes dynamiques — et, pire, figerait un en-tête « déconnecté »
 * dans le HTML prérendu.
 *
 * L'en-tête récupère donc son état ici, après hydratation.
 *
 * Ne renvoie que ce que la personne concernée peut déjà voir : aucun champ
 * privé, aucune adresse e-mail complète.
 */
export async function GET() {
  // Deux requêtes PostgreSQL par appel, et un appel par chargement de page :
  // indiscernable du trafic normal, donc parfait pour saturer le pool.
  // Celui-ci est réglé à UNE connexion par instance — c'est le bon réglage en
  // serverless, mais il laisse peu de marge.
  //
  // Confort, pas sécurité : une panne du compteur ne doit pas déconnecter
  // l'en-tête de tout le monde. D'où `sensitive: false`.
  const allowed = await checkRateLimit({
    key: `session:${await clientFingerprint()}`,
    limit: 120,
    windowSeconds: 60,
    sensitive: false,
  })
  if (!allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const user = await getCurrentUser()

  // Le compteur du panier vient d'ici pour la même raison que l'état de
  // session : l'en-tête est rendu sur des pages statiques, et y lire le panier
  // les rendrait toutes dynamiques. `readCartCount` ne lit qu'un décompte —
  // pas les titres, pas les images, pas les traductions.
  const cartCount = await readCartCount()

  const body = user
    ? {
        signedIn: true as const,
        firstName: user.firstName,
        role: user.role,
        cartCount,
      }
    : { signedIn: false as const, firstName: null, role: null, cartCount }

  return publicJson(body, {
    headers: {
      // Une réponse de session ne doit jamais être mise en cache, ni par le
      // navigateur, ni par un intermédiaire.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
