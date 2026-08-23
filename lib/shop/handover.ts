import 'server-only'

import { prisma } from '@/lib/db/client'
import {
  readShopSessionToken,
  rotateShopSessionToken,
} from '@/lib/shop/session-token'
import { mergeGuestFavorites } from '@/lib/shop/favorites-merge'
import { mergeGuestCart } from '@/lib/shop/cart'

/**
 * Reprise de ce qu'un visiteur avait fait avant d'ouvrir sa session.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi tout passe par ici
 * ---------------------------------------------------------------------------
 * Quatre choses appartiennent au JETON de session boutique et doivent basculer
 * vers le compte : les favoris, le panier, les commandes déjà payées sans
 * compte, et les offres déposées sans compte. Elles partagent toutes la même
 * contrainte, et c'est une contrainte qui ne pardonne pas : elles ont besoin de
 * l'ANCIEN jeton, donc elles doivent s'exécuter AVANT son renouvellement.
 *
 * Cette contrainte était écrite en commentaire à deux endroits — l'inscription
 * et la connexion — et respectée pour les seuls favoris. Le panier n'était
 * repris nulle part : `mergeGuestCart` existait, testée, et n'était appelée par
 * aucun code. Un visiteur qui remplissait son panier puis se connectait le
 * perdait, définitivement, puisque le renouvellement du jeton rendait le
 * panier invité inatteignable.
 *
 * Regrouper la reprise ET le renouvellement dans une seule fonction met fin à
 * cette catégorie d'oubli : il n'y a plus d'ordre à respecter à la main, plus
 * de quatrième chose à penser à ajouter aux deux endroits.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le renouvellement du jeton est indispensable
 * ---------------------------------------------------------------------------
 * Sur un poste partagé, la personne suivante ne doit pas hériter de ce que la
 * précédente avait mis de côté. Le jeton est renouvelé à chaque ouverture de
 * session, ce qui coupe le lien avec tout ce qui a été déposé avant.
 */

/**
 * Rattache au compte les commandes payées sans compte depuis ce navigateur.
 *
 * ---------------------------------------------------------------------------
 * Deux conditions, pas une
 * ---------------------------------------------------------------------------
 * Le jeton de session ET l'adresse e-mail de la commande doivent correspondre.
 *
 * Le jeton seul ne suffit pas : sur un poste partagé, quelqu'un qui achète
 * sans compte puis laisse la place verrait ses commandes — donc son adresse
 * postale et son adresse e-mail — atterrir dans le compte de la personne
 * suivante. Un rapprochement automatique n'a pas le droit de faire ça.
 *
 * L'adresse e-mail seule ne suffit pas non plus : l'inscription par mot de
 * passe ne vérifie pas l'adresse. Il suffirait de créer un compte au nom de
 * quelqu'un pour lire ses commandes.
 *
 * Les deux ensemble sont exigeants dans le bon sens : même navigateur, même
 * adresse. C'est le cas de très loin le plus fréquent — on achète, puis on se
 * crée un compte dans la foulée avec l'adresse qu'on vient de saisir.
 *
 * ---------------------------------------------------------------------------
 * `lockOwnerId` n'est PAS modifié
 * ---------------------------------------------------------------------------
 * Il désigne le propriétaire du verrou de stock, et `Article.reservedById`
 * porte la même valeur. Les réécrire ici les désynchroniserait : la libération
 * du verrou ne retrouverait plus ses articles, ou pire, en libérerait
 * d'autres. Seul `userId` change — c'est bien lui qui rattache la commande à
 * un compte, et `ownerScope` interroge les deux.
 */
async function attachGuestOrders(
  userId: string,
  sessionToken: string,
  email: string,
): Promise<number> {
  const result = await prisma.order.updateMany({
    where: {
      // Jamais une commande déjà rattachée : elle appartient à son compte, et
      // le fait qu'elle porte encore un vieux jeton ne change rien.
      userId: null,
      lockOwnerId: sessionToken,
      email: { equals: email, mode: 'insensitive' },
    },
    data: { userId },
  })

  return result.count
}

/**
 * Rattache au compte les offres déposées sans compte depuis ce navigateur.
 *
 * ---------------------------------------------------------------------------
 * Ce que l'oubli coûtait
 * ---------------------------------------------------------------------------
 * Une visiteuse négocie une pièce, l'offre est acceptée, un e-mail lui promet
 * ce prix pendant vingt-quatre heures. Elle ouvre un compte pour payer — le
 * geste le plus naturel du monde — et le jeton est renouvelé. Le panier, lui,
 * cherche désormais les offres du COMPTE (`readNegotiatedPrices`), n'en trouve
 * aucune, et facture le prix affiché.
 *
 * Rien n'aurait signalé l'écart : ni erreur, ni message. Juste un prix plus
 * élevé que celui promis par écrit, au moment de payer. C'est exactement le
 * défaut que ce fichier a été créé pour éteindre, sur un quatrième objet.
 *
 * ---------------------------------------------------------------------------
 * Les deux mêmes conditions que pour les commandes
 * ---------------------------------------------------------------------------
 * Le jeton ET l'adresse. Le jeton seul ferait hériter la personne suivante d'un
 * poste partagé des négociations de la précédente ; l'adresse seule suffirait à
 * les lire en créant un compte au nom de quelqu'un, l'inscription par mot de
 * passe ne vérifiant pas l'adresse.
 *
 * ---------------------------------------------------------------------------
 * Les traces d'invité sont EFFACÉES
 * ---------------------------------------------------------------------------
 * Contrairement à `lockOwnerId` sur les commandes, `guestEmail` et
 * `guestSessionToken` ne servent plus à rien une fois l'offre rattachée : la
 * portée passe par `userId`, et la réponse part vers l'adresse du compte. Les
 * garder laisserait une adresse e-mail recopiée hors du compte, sans usage.
 */
async function attachGuestOffers(
  userId: string,
  sessionToken: string,
  email: string,
): Promise<number> {
  const result = await prisma.offer.updateMany({
    where: {
      userId: null,
      guestSessionToken: sessionToken,
      guestEmail: { equals: email, mode: 'insensitive' },
    },
    data: { userId, guestEmail: null, guestSessionToken: null },
  })

  return result.count
}

export interface HandoverReport {
  favorites: number
  cartLines: number
  orders: number
  offers: number
}

/**
 * Bascule le travail du visiteur vers son compte, puis renouvelle le jeton.
 *
 * Appelée à l'inscription et à la connexion, juste après la création de la
 * session — et par elles seules. L'identité vient d'être établie par
 * l'appelant ; elle n'est jamais reçue du réseau, ce module étant
 * `server-only` et n'exposant aucune adresse.
 */
export async function adoptGuestSession(
  userId: string,
  email: string,
): Promise<HandoverReport> {
  const token = await readShopSessionToken()

  if (!token) {
    // Aucun jeton : rien n'a pu être déposé depuis ce navigateur. On en pose
    // tout de même un neuf, comme dans tous les autres cas.
    await rotateShopSessionToken()
    return { favorites: 0, cartLines: 0, orders: 0, offers: 0 }
  }

  // Séquentiel et non `Promise.all` : en production le pool n'accorde qu'une
  // connexion par instance, et `mergeGuestCart` ouvre une transaction
  // interactive qui la retient. Paralléliser n'y gagnerait rien et pourrait
  // faire attendre les autres jusqu'au délai d'expiration.
  const favorites = await mergeGuestFavorites(userId)
  // AVANT le panier : le panier résout le prix négocié à la lecture, et il le
  // cherche sous l'identité du compte dès que la session est ouverte. Rattacher
  // les offres ensuite laisserait une fenêtre où le panier fraîchement fusionné
  // afficherait le prix affiché plutôt que le prix promis.
  const offers = await attachGuestOffers(userId, token, email)
  const cartLines = await mergeGuestCart(userId)
  const orders = await attachGuestOrders(userId, token, email)

  // EN DERNIER, toujours : les quatre reprises ci-dessus lisent l'ancien jeton.
  await rotateShopSessionToken()

  return { favorites, cartLines, orders, offers }
}
