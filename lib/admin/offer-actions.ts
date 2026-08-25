'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db/client'
import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { respondToOfferSchema } from '@/lib/validation/admin'
import { isBelowFloor } from '@/lib/domain/offers'
import { respondToOffer } from '@/lib/shop/offers'

/**
 * Réponse du vendeur à une offre reçue.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte donc qu'UNE action, et elle commence par
 * `requireAdmin()`.
 *
 * Ce point mérite d'être dit précisément : le middleware protège `/admin`, mais
 * une Server Action n'est pas une page. Elle est appelée par une requête POST
 * vers l'URL de la PAGE qui l'a rendue — et rien n'oblige un attaquant à passer
 * par cette page. Le contrôle du rôle ici n'est donc pas une ceinture en plus
 * des bretelles : c'est la seule chose qui tienne. Le cahier des charges
 * l'écrit ainsi — « vérification du rôle dans chaque action serveur, jamais
 * uniquement dans le middleware ».
 *
 * ---------------------------------------------------------------------------
 * Ce que l'appelant NE fournit PAS
 * ---------------------------------------------------------------------------
 * Ni le montant de l'offre, ni le prix affiché, ni le prix plancher. Tout est
 * relu en base dans la transaction de `respondToOffer`. Le formulaire n'envoie
 * qu'un identifiant d'offre, une action, et — quand elle s'impose — une
 * déclaration d'intention.
 *
 * ---------------------------------------------------------------------------
 * La contre-proposition n'est PAS exposée, et c'est délibéré
 * ---------------------------------------------------------------------------
 * `respondToOffer` la gère, elle est testée, et le bouton tiendrait en dix
 * lignes. Elle est absente parce qu'elle enfermerait l'acheteuse :
 *
 *  - une contre-offre crée une nouvelle ligne `PENDING` à son nom ;
 *  - `evaluateOffer` refuse toute nouvelle proposition tant qu'une offre est en
 *    attente (`already-pending`) ;
 *  - et rien, aujourd'hui, ne lui permet d'ACCEPTER cette contre-offre — le
 *    registre `/compte/offres` l'affiche, sans action.
 *
 * Elle serait donc bloquée quarante-huit heures, sans recours, pour avoir
 * négocié. Livrer le bouton du vendeur sans la réponse de l'acheteuse
 * fabriquerait exactement le genre de fonctionnalité à moitié construite que ce
 * lot est venu réparer.
 *
 * Deux choses à traiter avec elle, le jour où elle arrivera :
 *  - `readOfferEmailData` (`lib/shop/offers.ts`) rabat tout statut autre
 *    qu'`ACCEPTED` ou `PENDING` sur « refusée » : une contre-offre annoncerait
 *    un refus. Il lui faut son propre gabarit ;
 *  - `respondToOffer` ne compare PAS une contre-offre au prix plancher — les
 *    seules bornes sont l'offre reçue et le prix affiché — et force
 *    `acceptedBelowFloor` à `false`. Le vendeur peut donc contre-proposer sous
 *    son propre plancher sans garde-fou ni trace.
 */

export type AdminOfferActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'done'; outcome: 'accepted' | 'rejected' }

const ERROR = (messageKey: string): AdminOfferActionState => ({
  status: 'error',
  messageKey,
})

/** Traduit un refus de `respondToOffer` en clé de message. */
function messageKeyFor(reason: string): string {
  switch (reason) {
    case 'not-found':
      return 'offerNotFound'
    case 'not-pending':
      // Le balayage des offres échues, un second onglet, un double clic. La
      // transition est conditionnelle en base : c'est là qu'elle se joue, pas
      // ici.
      return 'offerAlreadyAnswered'
    case 'article-unavailable':
      return 'articleSold'
    default:
      return 'unknown'
  }
}

export async function respondToOfferAction(
  _previous: AdminOfferActionState,
  formData: FormData,
): Promise<AdminOfferActionState> {
  // EN PREMIER, avant toute lecture de l'entrée : rien de ce qui suit ne doit
  // s'exécuter pour qui n'est pas administrateur, pas même une validation qui
  // révélerait la forme attendue.
  const admin = await requireAdmin()

  const parsed = respondToOfferSchema.safeParse({
    offerId: formData.get('offerId'),
    action: formData.get('action'),
    ...(formData.get('confirmBelowFloor')
      ? { confirmBelowFloor: formData.get('confirmBelowFloor') }
      : {}),
  })
  if (!parsed.success) return ERROR('invalidRequest')

  // Compteur sur l'IDENTITÉ PROUVÉE, pas sur l'empreinte d'adresse.
  //
  // L'appelant est authentifié : l'empreinte serait à la fois trop large — une
  // sortie d'entreprise partage un seau — et inutile. Le plafond ne protège pas
  // d'un administrateur malveillant, il protège du script qui boucle : chaque
  // réponse ouvre une transaction et inscrit un e-mail, et la production
  // n'accorde qu'une connexion par instance.
  const allowed = await checkRateLimit({
    key: `offer-respond:${admin.id}`,
    limit: 60,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return ERROR('rateLimited')

  // -------------------------------------------------------------------------
  // Le franchissement du plancher se CONSTATE ici, il ne se déclare pas
  // -------------------------------------------------------------------------
  // Le plancher est relu en base. Le formulaire ne l'a jamais eu entre les
  // mains, et la case cochée ne vaut pas permission : elle vaut intention. Si
  // l'offre passe sous le plancher et que l'intention manque, on refuse et on
  // le dit — c'est ce qui donne son sens à la trace `acceptedBelowFloor`, qui
  // sans cela enregistrerait un clic distrait comme une décision commerciale.
  if (parsed.data.action === 'accept') {
    const offer = await prisma.offer.findUnique({
      where: { id: parsed.data.offerId },
      select: {
        amountCents: true,
        article: { select: { floorPriceCents: true } },
      },
    })
    if (!offer) return ERROR('offerNotFound')

    const below = isBelowFloor(offer.amountCents, offer.article.floorPriceCents)
    if (below && parsed.data.confirmBelowFloor !== 'on') {
      return ERROR('floorConfirmationRequired')
    }
  }

  const result = await respondToOffer({
    offerId: parsed.data.offerId,
    response:
      parsed.data.action === 'accept' ? { action: 'accept' } : { action: 'reject' },
  })

  if (!result.ok) return ERROR(messageKeyFor(result.reason))

  // La liste doit refléter la décision : sans invalidation, l'offre resterait
  // affichée « en attente » jusqu'au prochain rechargement complet.
  revalidatePath('/', 'layout')

  return {
    status: 'done',
    outcome: result.status === 'ACCEPTED' ? 'accepted' : 'rejected',
  }
}
