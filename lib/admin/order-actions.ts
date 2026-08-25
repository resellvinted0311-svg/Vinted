'use server'

import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { advanceOrderSchema } from '@/lib/validation/admin'
import { advanceOrder } from '@/lib/shop/fulfilment'

/**
 * Faire avancer une commande : préparation, expédition, livraison.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte donc qu'UNE action, et elle commence par
 * `requireAdmin()`.
 *
 * Le middleware protège `/admin`, mais une Server Action n'est pas une page :
 * elle est appelée par un POST vers l'URL de la page qui l'a rendue, et rien
 * n'oblige un appelant à passer par cette page. Sans le contrôle ici, marquer
 * la commande de quelqu'un d'autre comme livrée ne demanderait qu'un
 * identifiant — et une commande livrée est une commande dont le délai de
 * rétractation court.
 *
 * ---------------------------------------------------------------------------
 * Ce que l'appelant NE fournit PAS
 * ---------------------------------------------------------------------------
 * L'état d'arrivée. Il envoie un geste ; le serveur relit l'état courant en
 * base et laisse `planTransition` décider si le geste est permis depuis là.
 * C'est ce qui interdit de reculer, de sauter une étape, ou d'expédier une
 * commande annulée — trois choses qu'un `status` reçu du réseau permettrait.
 *
 * L'e-mail non plus, ni l'adresse : `advanceOrder` les relit. Rien de ce qui
 * part vers l'acheteuse ne transite par ce formulaire.
 */

export type AdminOrderActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'done'; reached: 'PREPARING' | 'SHIPPED' | 'DELIVERED' }

const ERROR = (messageKey: string): AdminOrderActionState => ({
  status: 'error',
  messageKey,
})

/**
 * Une valeur de formulaire, ou rien.
 *
 * Un champ laissé vide arrive comme une chaîne VIDE, jamais comme `undefined`.
 * La laisser passer inscrirait une expédition dont le numéro de suivi serait la
 * chaîne vide : pire qu'aucun numéro, parce qu'elle s'afficherait à l'écran et
 * dans l'e-mail comme un suivi qu'on peut consulter.
 */
function optional(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export async function advanceOrderAction(
  _previous: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  // EN PREMIER, avant toute lecture de l'entrée : rien de ce qui suit ne doit
  // s'exécuter pour qui n'est pas administrateur, pas même une validation qui
  // révélerait la forme attendue.
  const admin = await requireAdmin()

  const action = formData.get('action')
  const parsed = advanceOrderSchema.safeParse({
    orderId: formData.get('orderId'),
    action,
    // Les champs de suivi n'existent que sur l'expédition, et le schéma les
    // refuse ailleurs. On ne les présente donc qu'à ce geste-là : les envoyer
    // sur « préparer » ferait échouer la validation au lieu de les ignorer,
    // ce qui est le bon comportement mais un mauvais message d'erreur.
    ...(action === 'ship'
      ? {
          trackingNumber: optional(formData.get('trackingNumber')),
          trackingUrl: optional(formData.get('trackingUrl')),
        }
      : {}),
  })
  if (!parsed.success) return ERROR('invalidRequest')

  // Compteur sur l'IDENTITÉ PROUVÉE, pas sur l'empreinte d'adresse.
  //
  // L'appelant est authentifié : l'empreinte serait à la fois trop large — une
  // sortie d'entreprise partage un seau — et inutile. Le plafond ne protège pas
  // d'un administrateur malveillant, il protège du script qui boucle : chaque
  // avancement ouvre une transaction, et une expédition inscrit un e-mail. La
  // production n'accorde qu'une connexion par instance.
  const allowed = await checkRateLimit({
    key: `order-advance:${admin.id}`,
    limit: 120,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return ERROR('rateLimited')

  const result = await advanceOrder({
    orderId: parsed.data.orderId,
    action: parsed.data.action,
    // Le lien seul ne fait pas une expédition suivie : sans numéro, il n'y a
    // rien à suivre, et créer une ligne `Shipment` porteuse d'une seule URL
    // ferait afficher « suivi disponible » sur un envoi qui n'en a pas.
    tracking:
      parsed.data.action === 'ship' && parsed.data.trackingNumber
        ? {
            number: parsed.data.trackingNumber,
            url: parsed.data.trackingUrl ?? null,
          }
        : undefined,
  })

  if (!result.ok) {
    return ERROR(
      result.reason === 'not-found' ? 'orderNotFound' : 'invalidTransition',
    )
  }

  // La file doit refléter le geste : sans invalidation, la commande resterait
  // affichée « payée » jusqu'au prochain rechargement complet, et le bouton
  // « Expédier » resterait cliquable sur un colis déjà parti.
  // Aucune invalidation de cache ici, et c'est délibéré.
  //
  // `revalidatePath('/', 'layout')` purge TOUT ce que la mise en page racine
  // enveloppe — les 171 pages prérendues. Il ne rafraîchissait rien : les pages
  // qui portent l'état d'une négociation ou d'une commande sont toutes
  // `force-dynamic`, donc jamais mises en cache, et la fiche article ne lit
  // aucune donnée d'offre au rendu (le formulaire est un composant client).
  //
  // Purger un cache dont rien ne dépend est gratuit en apparence seulement :
  // sur un chemin ouvert au public, c'est un levier de déni de service, et le
  // catalogue cesse d'être servi depuis le cache. Voir
  // `tests/security/cache-invalidation.test.ts`.

  // `planTransition` ne renvoie que ces trois états ; le domaine l'énumère.
  return {
    status: 'done',
    reached: result.status as 'PREPARING' | 'SHIPPED' | 'DELIVERED',
  }
}
