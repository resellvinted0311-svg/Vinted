import { NextResponse } from 'next/server'
import { publicJson } from '@/lib/security/public-json'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { getCurrentUser } from '@/lib/auth/session'
import { cartOwnerFor, readCartCount } from '@/lib/shop/cart'
import { readFavoriteIds } from '@/lib/shop/favorites-count'

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
  //
  // L'identité est passée, pas relue. `getCurrentUser` est mémorisée par
  // `cache()` de React, mais cette mémorisation ne s'applique PAS dans un
  // gestionnaire de route : appeler `readCartCount()` sans argument décodait la
  // session une SECONDE fois, ici, sur chaque chargement de page du site.
  // Mesuré : six requêtes sur la table des comptes par appel, contre trois
  // maintenant.
  /*
    Les deux lectures se font EN PARALLÈLE.

    Elles ne dépendent pas l'une de l'autre, et cette route est appelée à
    chaque chargement de page du site — les enchaîner ajouterait un
    aller-retour de base de données au chemin critique de l'en-tête, pour rien.

    L'identité est passée aux deux, jamais relue : voir le commentaire
    ci-dessus, et celui de `readFavoriteIds`.
  */
  const [cartCount, favoriteIds] = await Promise.all([
    readCartCount(await cartOwnerFor(user)),
    readFavoriteIds(user),
  ])

  /*
    La LISTE des favoris voyage avec l'état de session, et le décompte s'en
    déduit.

    Elle venait d'ailleurs : `getFavoriteArticleIds`, une Server Action que
    `FavoritesProvider` appelait au montage. Chaque chargement de page payait
    donc DEUX allers-retours pour la même session — celui-ci, puis le sien —
    et deux décodages de session pour deux lectures de la même table.

    Le décompte n'est plus compté par la base : `favoriteIds.length` dit la
    même chose sans seconde requête. La liste des favoris d'une personne se
    compte en dizaines ; ramener les identifiants coûte moins qu'un
    aller-retour supplémentaire.
  */
  const favoriteCount = favoriteIds.length

  const body = user
    ? {
        signedIn: true as const,
        firstName: user.firstName,
        role: user.role,
        cartCount,
        favoriteCount,
        favoriteIds,
      }
    : {
        signedIn: false as const,
        firstName: null,
        role: null,
        cartCount,
        favoriteCount,
        favoriteIds,
      }

  return publicJson(body, {
    headers: {
      // Une réponse de session ne doit jamais être mise en cache, ni par le
      // navigateur, ni par un intermédiaire.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
