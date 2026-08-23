import 'server-only'

import type Stripe from 'stripe'

/**
 * Ce qu'on garde d'un événement Stripe, et rien de plus.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi on ne garde pas l'événement entier
 * ---------------------------------------------------------------------------
 * Un `checkout.session.completed` transporte `customer_details` : nom,
 * adresse e-mail, téléphone et adresse postale complète. Un
 * `payment_intent.succeeded` transporte `billing_details` de la carte. Archivés
 * tels quels, ces objets constituent une SECONDE copie des données de la
 * personne, en dehors de la commande — donc en dehors du registre des
 * traitements, en dehors de l'export de l'article 15, et en dehors de
 * l'effacement de l'article 17.
 *
 * Le pire : cette copie survivait à l'effacement. On vidait soigneusement
 * l'adresse e-mail et la note de la commande, et l'événement qui les portait
 * restait intact à côté, pour toujours.
 *
 * ---------------------------------------------------------------------------
 * Liste blanche, jamais liste noire
 * ---------------------------------------------------------------------------
 * C'est la doctrine du reste du projet — les sélecteurs Prisma énumèrent les
 * colonnes voulues plutôt que d'exclure les colonnes privées — et elle vaut
 * doublement ici : la forme des événements appartient à Stripe, pas à nous.
 * Un champ ajouté par une version future de leur interface arriverait dans nos
 * journaux sans que personne ne l'ait décidé. Avec une liste blanche, il
 * n'arrive pas.
 *
 * ---------------------------------------------------------------------------
 * À quoi sert ce qui reste
 * ---------------------------------------------------------------------------
 * À comprendre après coup pourquoi un encaissement a échoué : quel événement,
 * pour quelle commande, quel montant, quel état. L'idempotence, elle, ne
 * dépend pas du tout de ce contenu : elle repose sur `externalId`, qui porte
 * une contrainte d'unicité.
 */

/** Trace conservée d'un événement, dépourvue de donnée personnelle. */
export interface RedactedWebhookEvent {
  id: string
  type: string
  createdAt: number
  livemode: boolean
  /** Ce qu'on sait de l'objet transporté, champ par champ. */
  object: Record<string, string | number | boolean | null>
}

/** Lit une valeur scalaire, ou rien. Jamais un objet imbriqué. */
function scalar(
  source: Record<string, unknown>,
  key: string,
): string | number | boolean | null | undefined {
  const value = source[key]
  if (value === null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  // Un objet, un tableau, une fonction : on ne le recopie pas. C'est
  // exactement là que se cachent `customer_details` et `billing_details`.
  return undefined
}

/**
 * Champs retenus de l'objet transporté.
 *
 * Aucun ne peut désigner une personne : ce sont des identifiants de nos
 * propres enregistrements, des montants, des états.
 *
 * `metadata` n'est PAS repris en bloc — on en tire les deux clés que nous
 * posons nous-mêmes, et elles seules. Reprendre l'objet entier rouvrirait la
 * porte le jour où quelqu'un y ajoutera un nom.
 */
const KEPT_FIELDS = [
  'id',
  'object',
  'status',
  'payment_status',
  'amount',
  'amount_total',
  'amount_subtotal',
  'amount_received',
  'currency',
  'mode',
  'client_reference_id',
  'payment_intent',
  'invoice',
  'expires_at',
  'created',
] as const

export function redactStripeEvent(event: Stripe.Event): RedactedWebhookEvent {
  const raw = event.data.object as unknown as Record<string, unknown>

  const object: Record<string, string | number | boolean | null> = {}
  for (const field of KEPT_FIELDS) {
    const value = scalar(raw, field)
    if (value !== undefined) object[field] = value
  }

  // Les deux repères que nous inscrivons nous-mêmes à l'ouverture du paiement.
  const metadata = raw.metadata
  if (metadata && typeof metadata === 'object') {
    const record = metadata as Record<string, unknown>
    for (const key of ['orderId', 'orderNumber'] as const) {
      const value = scalar(record, key)
      if (typeof value === 'string') object[`metadata.${key}`] = value
    }
  }

  return {
    id: event.id,
    type: event.type,
    createdAt: event.created,
    livemode: event.livemode,
    object,
  }
}
