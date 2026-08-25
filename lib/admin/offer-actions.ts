'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db/client'
import { requireAdmin } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { respondToOfferSchema } from '@/lib/validation/admin'
import { isBelowFloor } from '@/lib/domain/offers'
import { parseAmountToCents } from '@/lib/domain/money'
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
 * La contre-proposition est exposée — et ce qu'il a fallu réparer d'abord
 * ---------------------------------------------------------------------------
 * Elle était volontairement absente, parce qu'elle enfermait l'acheteuse : une
 * contre-offre crée une ligne `PENDING` à son nom, `already-pending` lui
 * interdit alors d'en déposer une autre, et rien ne lui permettait de répondre.
 * Elle aurait été bloquée quarante-huit heures pour avoir négocié.
 *
 * Trois défauts ont été corrigés avec elle, et aucun n'était visible tant que
 * le bouton n'existait pas :
 *
 *  - `readOfferEmailData` rabattait tout statut autre qu'`ACCEPTED` ou
 *    `PENDING` sur « refusée ». Une contre-proposition aurait annoncé un REFUS
 *    à quelqu'un à qui l'on propose un prix. Elle a désormais son gabarit, qui
 *    porte le montant et la date avant laquelle répondre ;
 *
 *  - `respondToOffer` ne comparait la contre-offre à AUCUN plancher — les
 *    seules bornes étaient l'offre reçue et le prix affiché. Le vendeur pouvait
 *    proposer sous son propre plancher sans garde-fou ni trace. La déclaration
 *    est maintenant exigée, ici comme pour l'acceptation, et `acceptedBelowFloor`
 *    est posée à l'acceptation par l'acheteuse — l'instant où le prix devient dû ;
 *
 *  - le délai de carence se déclenchait sur la dernière offre `REJECTED`, sans
 *    écarter les contre-propositions. Décliner une proposition DU VENDEUR
 *    l'aurait punie d'un délai d'attente. La requête écarte désormais les
 *    lignes chaînées, comme le fait déjà le compteur de tentatives.
 *
 * Une contre-proposition n'est possible que sur une offre portée par un COMPTE.
 * `respondToOffer` refuse les autres : une invitée n'a aucun écran où répondre,
 * et lui en adresser une reproduirait le piège qu'on vient de fermer.
 */

export type AdminOfferActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'done'; outcome: 'accepted' | 'rejected' | 'countered' }

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
    case 'invalid-counter':
      return 'invalidCounter'
    case 'counter-needs-account':
      return 'counterNeedsAccount'
    case 'counter-below-floor':
      return 'floorConfirmationRequired'
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

  const action = formData.get('action')
  const parsed = respondToOfferSchema.safeParse({
    offerId: formData.get('offerId'),
    action,
    ...(formData.get('confirmBelowFloor')
      ? { confirmBelowFloor: formData.get('confirmBelowFloor') }
      : {}),
    // Le montant n'est présenté qu'à la contre-proposition : le schéma le
    // refuse ailleurs, ce qui est le bon comportement mais donnerait un
    // mauvais message d'erreur sur une acceptation.
    ...(action === 'counter'
      ? { counterAmountEuros: formData.get('counterAmountEuros') }
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

  // La conversion se fait ICI, sur la chaîne saisie, comme pour le dépôt d'une
  // offre : une personne francophone tape une virgule décimale, et un montant
  // en centimes qui traverserait le navigateur serait un montant réécrit.
  let counterAmountCents = 0
  if (parsed.data.action === 'counter') {
    const amount = parseAmountToCents(parsed.data.counterAmountEuros)
    if (amount === null || amount <= 0) return ERROR('invalidCounter')
    counterAmountCents = amount
  }

  const result = await respondToOffer({
    offerId: parsed.data.offerId,
    response:
      parsed.data.action === 'accept'
        ? { action: 'accept' }
        : parsed.data.action === 'reject'
          ? { action: 'reject' }
          : {
              action: 'counter',
              counterAmountCents,
              confirmBelowFloor: parsed.data.confirmBelowFloor === 'on',
            },
  })

  if (!result.ok) return ERROR(messageKeyFor(result.reason))

  // La liste doit refléter la décision : sans invalidation, l'offre resterait
  // affichée « en attente » jusqu'au prochain rechargement complet.
  revalidatePath('/', 'layout')

  return {
    status: 'done',
    outcome:
      result.status === 'ACCEPTED'
        ? 'accepted'
        : result.status === 'COUNTERED'
          ? 'countered'
          : 'rejected',
  }
}
