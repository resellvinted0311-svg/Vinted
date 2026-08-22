'use server'

import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { countryCodeSchema, postalCodeSchema } from '@/lib/validation/checkout'
import { localeSchema } from '@/lib/validation/auth'
import { z } from 'zod'
import {
  quoteShippingForCart,
  type ShippingOptionsView,
} from '@/lib/shop/shipping-options'

/**
 * Devis de port, pour le tunnel de commande.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * Un seul export, et il ne fait qu'une chose : calculer un devis pour le
 * panier de la session courante. Il n'écrit rien, ne verrouille rien, ne crée
 * aucune commande.
 *
 * ---------------------------------------------------------------------------
 * Ce devis n'engage rien
 * ---------------------------------------------------------------------------
 * Il sert à afficher les modes de livraison et leur prix pendant la saisie.
 * Le montant qui fait foi est recalculé intégralement par `prepareCheckout`,
 * à partir de la base, au moment d'ouvrir le paiement. Si une grille change
 * entre les deux, c'est le second calcul qui gagne — et l'écart se voit sur
 * le récapitulatif, avant tout débit.
 */

const quoteInputSchema = z.object({
  countryCode: countryCodeSchema,
  /**
   * Absent tant que la personne n'a rien saisi.
   *
   * Ce n'est pas la même chose qu'une chaîne vide : la résolution de zone
   * REFUSE explicitement une destination sans code postal là où un pays est
   * découpé par préfixes (Corse, outre-mer). Cette distinction est ce qui
   * empêche de facturer Nouméa au tarif de la métropole.
   */
  postalCode: postalCodeSchema.optional(),
  locale: localeSchema,
})

export type ShippingQuoteState =
  | { status: 'ok'; view: ShippingOptionsView }
  | {
      status: 'error'
      messageKey:
        | 'unavailable'
        | 'emptyCart'
        | 'invalidAddress'
        | 'rateLimited'
    }

export async function quoteShippingAction(
  input: unknown,
): Promise<ShippingQuoteState> {
  // Chaque frappe dans le champ « code postal » peut déclencher un devis, et
  // un devis lit deux grilles en base. Confort et non sécurité : rien n'est
  // verrouillé ici, une panne du compteur ne doit pas bloquer une commande.
  const allowed = await checkRateLimit({
    key: `shipping-quote:${await clientFingerprint()}`,
    limit: 30,
    windowSeconds: 60,
    sensitive: false,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const parsed = quoteInputSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 'error', messageKey: 'invalidAddress' }
  }

  const result = await quoteShippingForCart(
    {
      countryCode: parsed.data.countryCode,
      postalCode: parsed.data.postalCode ?? null,
    },
    parsed.data.locale,
  )

  if (result.ok) return { status: 'ok', view: result.view }

  if (result.failure.reason === 'EMPTY_CART') {
    return { status: 'error', messageKey: 'emptyCart' }
  }

  // Les quatre motifs d'échec de devis — zone inconnue, code postal requis,
  // aucun tarif pour la zone, poids non couvert — sont volontairement aplatis
  // en un seul message. Ils décrivent NOTRE grille tarifaire, pas l'adresse de
  // la personne, et les détailler reviendrait à publier la carte de nos coûts.
  return { status: 'error', messageKey: 'unavailable' }
}
