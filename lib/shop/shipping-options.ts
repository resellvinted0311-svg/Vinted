import 'server-only'

import { getSettings } from '@/lib/config/settings'
import { getShippingGrids } from '@/lib/db/queries/shipping'
import { quoteShipping, type ShippingFailure } from '@/lib/domain/shipping'
import { computeOrderAmounts } from '@/lib/domain/order-total'
import { isPurchasable } from '@/lib/domain/cart'
import { readCart, type CartView } from '@/lib/shop/cart'

/**
 * Modes de livraison proposés pour une destination.
 *
 * ---------------------------------------------------------------------------
 * Ce module ne verrouille rien et ne crée rien
 * ---------------------------------------------------------------------------
 * Il ne fait qu'un devis, pour que le tunnel puisse afficher les choix et leur
 * prix avant l'étape de paiement. Le verrou de stock, la commande et la session
 * Stripe restent l'affaire de `prepareCheckout`, qui recalcule TOUT à partir de
 * la base — y compris ce devis.
 *
 * Autrement dit : ce qui est affiché ici est indicatif au sens strict. Si une
 * grille change entre l'affichage et le paiement, c'est le calcul du paiement
 * qui fait foi, et l'écart se voit sur l'écran de confirmation avant tout
 * débit. L'inverse — faire confiance au prix affiché — serait exactement le
 * défaut que le cahier des charges interdit.
 *
 * ---------------------------------------------------------------------------
 * Le coût transporteur ne sort pas d'ici
 * ---------------------------------------------------------------------------
 * `ShippingOption.carrierCostCents` est ce que le transporteur nous facture.
 * C'est une donnée de l'entreprise, et cette fonction est appelée depuis une
 * page. On construit donc une vue explicite plutôt que de repasser l'objet du
 * domaine : une propriété privée ajoutée demain au type du domaine ne pourrait
 * pas se glisser dans la réponse par simple omission.
 */

export interface ShippingOptionView {
  carrierCode: string
  serviceCode: string
  label: string
  /** Prix réellement dû, franchise appliquée. */
  chargedCents: number
  /** Prix hors franchise. Sert au prix barré, et seulement quand il diffère. */
  fullChargedCents: number
  freeShippingApplied: boolean
  deliveryDaysMin: number
  deliveryDaysMax: number
  requiresServicePoint: boolean
}

export interface ShippingOptionsView {
  zone: {
    code: string
    name: string
    requiresCustoms: boolean
    freeShippingThresholdCents: number | null
  }
  options: ShippingOptionView[]
  /** Sous-total des lignes payables, celui sur lequel porte la franchise. */
  subtotalCents: number
  /**
   * Poids réel du colis, emballage compris.
   *
   * Affiché parce qu'il explique le prix : sur une grille au palier, deux
   * paniers voisins peuvent tomber de part et d'autre d'une limite. C'est un
   * fait mesuré, pas un argument.
   */
  parcelWeightGrams: number
}

export type ShippingOptionsResult =
  | { ok: true; view: ShippingOptionsView }
  | { ok: false; failure: ShippingFailure }
  | { ok: false; failure: { reason: 'EMPTY_CART' } }

/**
 * Devis pour le panier courant, tel qu'il est en base.
 *
 * `cart` peut être passé par l'appelant qui vient déjà de le lire — une page de
 * tunnel affiche le récapitulatif ET les modes de livraison, et relire le
 * panier deux fois par rendu ouvrirait la porte à deux états différents dans le
 * même écran.
 */
export async function quoteShippingForCart(
  destination: { countryCode: string; postalCode: string | null },
  locale: string,
  cart?: CartView,
): Promise<ShippingOptionsResult> {
  const view = cart ?? (await readCart(locale))

  // Seules les lignes payables entrent dans le poids et dans le sous-total.
  // Compter une pièce déjà vendue gonflerait le colis d'un palier tarifaire et
  // pourrait déclencher une franchise de port qui n'est pas due.
  const payable = view.lines.filter((line) => isPurchasable(line.state))
  if (payable.length === 0) {
    return { ok: false, failure: { reason: 'EMPTY_CART' } }
  }

  const settings = await getSettings([
    'packagingWeightGrams',
    'shippingMarkupPercent',
  ])
  const grids = await getShippingGrids()

  const amounts = computeOrderAmounts({
    itemPricesCents: payable.map((line) => line.currentPriceCents),
    shippingCents: 0,
  })

  const quote = quoteShipping(
    {
      destination,
      articleWeightsGrams: payable.map((line) => line.weightGrams),
      subtotalCents: amounts.subtotalCents,
    },
    grids.zones,
    grids.rates,
    settings,
  )

  if (!quote.ok) return { ok: false, failure: quote.failure }

  return {
    ok: true,
    view: {
      zone: quote.quote.zone,
      subtotalCents: amounts.subtotalCents,
      parcelWeightGrams: quote.quote.parcelWeightGrams,
      options: quote.quote.options.map((option) => ({
        carrierCode: option.carrierCode,
        serviceCode: option.serviceCode,
        label: option.label,
        chargedCents: option.chargedCents,
        fullChargedCents: option.fullChargedCents,
        freeShippingApplied: option.freeShippingApplied,
        deliveryDaysMin: option.deliveryDaysMin,
        deliveryDaysMax: option.deliveryDaysMax,
        requiresServicePoint: option.requiresServicePoint,
        // Volontairement absent : carrierCostCents.
      })),
    },
  }
}
