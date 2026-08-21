'use server'

import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { startCheckoutSchema } from '@/lib/validation/checkout'
import { prepareCheckout, type CheckoutFailure } from '@/lib/shop/checkout'

/**
 * Ouverture du tunnel de commande.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` rend PUBLIC tout ce qu'il exporte. Ce fichier n'expose donc
 * qu'une seule fonction, et elle :
 *
 *  - valide intégralement son entrée avec Zod avant de toucher à quoi que ce
 *    soit ;
 *  - ne reçoit AUCUN montant, AUCUN identifiant d'article, AUCUN prix. Le
 *    panier est retrouvé côté serveur par le jeton de session ou le compte ;
 *  - dérive l'identité de l'appelant de la session, jamais d'un paramètre.
 *
 * Tout le reste du tunnel vit dans `checkout.ts`, marqué `server-only`, qui
 * n'expose aucune adresse.
 */

export type CheckoutActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string; articleIds?: string[] }
  | {
      status: 'ready'
      clientSecret: string
      orderNumber: string
      totalCents: number
    }

/** Traduit un échec métier en clé de message, sans fuiter de détail interne. */
function messageKeyFor(failure: CheckoutFailure): string {
  switch (failure.reason) {
    case 'payment-not-configured':
      return 'paymentNotConfigured'
    case 'empty-cart':
      return 'emptyCart'
    case 'blocked-lines':
      return 'blockedLines'
    case 'shipping-unavailable':
      // Le motif précis du devis — zone inconnue, poids non couvert — est
      // délibérément aplati ici : il décrit notre grille tarifaire, pas
      // l'adresse de la personne, et n'a rien à faire dans une réponse.
      return 'shippingUnavailable'
    case 'unknown-shipping-option':
      return 'shippingOptionGone'
    case 'service-point-required':
      return 'servicePointRequired'
    case 'stock-taken':
      return 'stockTaken'
  }
}

export async function startCheckoutAction(
  _prev: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  // Ouvrir un paiement verrouille du stock et crée une commande. Chemin
  // sensible : une panne du compteur ferme la porte plutôt que de la laisser
  // battre.
  const allowed = await checkRateLimit({
    key: `checkout:${await clientFingerprint()}`,
    limit: 10,
    windowSeconds: 600,
    sensitive: true,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const parsed = startCheckoutSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
    shippingAddress: {
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      line1: formData.get('line1'),
      line2: formData.get('line2') || undefined,
      postalCode: formData.get('postalCode'),
      city: formData.get('city'),
      country: formData.get('country'),
      phone: formData.get('phone') || undefined,
    },
    shipping: {
      carrierCode: formData.get('carrierCode'),
      serviceCode: formData.get('serviceCode'),
      servicePointId: formData.get('servicePointId') || undefined,
    },
    customerNote: formData.get('customerNote') || undefined,
    acceptsTerms: formData.get('acceptsTerms') === 'on',
  })

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') ?? ''
    return {
      status: 'error',
      messageKey: field.startsWith('shippingAddress')
        ? 'invalidAddress'
        : field === 'acceptsTerms'
          ? 'termsRequired'
          : 'invalidInput',
    }
  }

  const result = await prepareCheckout(parsed.data)

  if (!result.ok) {
    return {
      status: 'error',
      messageKey: messageKeyFor(result.failure),
      ...('articleIds' in result.failure
        ? { articleIds: result.failure.articleIds }
        : {}),
    }
  }

  return {
    status: 'ready',
    clientSecret: result.clientSecret,
    orderNumber: result.orderNumber,
    totalCents: result.totalCents,
  }
}
