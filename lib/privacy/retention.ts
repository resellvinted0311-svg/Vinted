import 'server-only'

import { prisma } from '@/lib/db/client'
import {
  ABANDONED_ORDER_RETENTION_DAYS,
  GUEST_DATA_RETENTION_DAYS,
  INACTIVE_ACCOUNT_RETENTION_DAYS,
  WEBHOOK_EVENT_RETENTION_DAYS,
} from '@/lib/config/privacy'
import { anonymizeUser, anonymizeAbandonedOrders } from './anonymize'

/**
 * Application des durées de conservation.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une purge automatique et pas une case à cocher
 * ---------------------------------------------------------------------------
 * Annoncer une durée de conservation sans mécanisme pour l'appliquer, c'est
 * une déclaration fausse. Le RGPD demande que les données soient conservées
 * « pendant une durée n'excédant pas celle nécessaire » (article 5.1.e) — pas
 * qu'on ait l'intention de les effacer un jour.
 *
 * Les durées ne sont pas écrites ici : elles viennent du registre
 * (`lib/config/privacy.ts`), le même que celui qu'affiche la page publique.
 * Allonger le texte sans allonger la purge devient impossible.
 *
 * ---------------------------------------------------------------------------
 * Ce que la purge ne touche jamais
 * ---------------------------------------------------------------------------
 * Les commandes PAYÉES. Une facture relève de l'obligation comptable — dix
 * ans, article L123-22 du code de commerce — et l'article 17.3.b du RGPD
 * écarte explicitement l'effacement dans ce cas. Un compte inactif est donc
 * ANONYMISÉ, jamais supprimé : la ligne comptable survit, l'identité non.
 *
 * ---------------------------------------------------------------------------
 * L'exception qui manquait : les tunnels abandonnés
 * ---------------------------------------------------------------------------
 * Cette règle a longtemps été appliquée à la table `Order` EN BLOC, au motif
 * que les factures s'y trouvent. Conséquence : une commande jamais payée —
 * avec nom, rue, code postal, ville, téléphone et adresse e-mail — n'était
 * purgée par rien, indéfiniment. Or elle n'est pas une pièce comptable : aucun
 * paiement, aucune facture, aucun exercice ne la porte. Rien ne fondait donc
 * de la garder, et les abandons sont plus nombreux que les ventes.
 */

export interface PurgeReport {
  expiredSessions: number
  expiredVerificationTokens: number
  expiredUserTokens: number
  guestFavorites: number
  abandonedGuestCarts: number
  /** Traces d'événements de paiement, périmées. */
  webhookEvents: number
  /** Tunnels jamais payés, vidés de leurs coordonnées. */
  anonymizedAbandonedOrders: number
  anonymizedAccounts: number
}

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * `now` est un paramètre : sans cela, aucun test ne peut se placer trois ans
 * plus tard, et la branche la plus délicate — l'anonymisation — resterait
 * non vérifiée jusqu'au jour où elle s'exécuterait pour de vrai.
 */
export async function purgeExpiredPersonalData(
  now = new Date(),
): Promise<PurgeReport> {
  const guestCutoff = daysAgo(GUEST_DATA_RETENTION_DAYS, now)
  const abandonedOrderCutoff = daysAgo(ABANDONED_ORDER_RETENTION_DAYS, now)
  const webhookCutoff = daysAgo(WEBHOOK_EVENT_RETENTION_DAYS, now)
  const inactiveCutoff = daysAgo(INACTIVE_ACCOUNT_RETENTION_DAYS, now)

  // Jetons et sessions périmés : ils n'ouvrent plus rien, les garder ne sert
  // qu'à garder l'adresse e-mail qui y est parfois attachée.
  const [expiredSessions, expiredVerificationTokens, expiredUserTokens] =
    await Promise.all([
      prisma.session.deleteMany({ where: { expires: { lt: now } } }),
      prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
      prisma.userToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ])

  // Favoris de visiteurs : rattachés au cookie de session boutique. Passé sa
  // durée de vie, plus personne ne peut les retrouver — pas même la personne
  // concernée. Les conserver n'aurait aucune utilité pour elle.
  const guestFavorites = await prisma.guestFavorite.deleteMany({
    where: { createdAt: { lt: guestCutoff } },
  })

  // Paniers de visiteurs sans compte, sans activité. Ceux d'un compte
  // survivent : la personne les retrouvera à sa prochaine connexion.
  const abandonedGuestCarts = await prisma.cart.deleteMany({
    where: { userId: null, updatedAt: { lt: guestCutoff } },
  })

  // Traces d'événements de paiement. Elles sont déjà caviardées à l'écriture
  // — voir lib/payments/webhook-payload.ts — mais une trace technique qui ne
  // sert plus n'a pas à survivre pour autant. Effacer ne rouvre pas la porte
  // au rejeu : la signature Stripe porte un horodatage et refuse l'ancien.
  const webhookEvents = await prisma.webhookEvent.deleteMany({
    where: { createdAt: { lt: webhookCutoff } },
  })

  // Tunnels de commande jamais payés. On vide, on ne supprime pas : un
  // paiement a pu aboutir sans que le webhook nous parvienne, et la ligne est
  // alors la seule trace d'un débit à retrouver.
  const anonymizedAbandonedOrders =
    await anonymizeAbandonedOrders(abandonedOrderCutoff)

  const anonymizedAccounts = await anonymizeInactiveAccounts(inactiveCutoff)

  return {
    expiredSessions: expiredSessions.count,
    expiredVerificationTokens: expiredVerificationTokens.count,
    expiredUserTokens: expiredUserTokens.count,
    guestFavorites: guestFavorites.count,
    abandonedGuestCarts: abandonedGuestCarts.count,
    webhookEvents: webhookEvents.count,
    anonymizedAbandonedOrders,
    anonymizedAccounts,
  }
}

/**
 * Comptes sans connexion depuis trois ans.
 *
 * `lastSeenAt` peut être nul — un compte créé puis jamais réutilisé. On
 * retombe alors sur la date de création, qui est la dernière trace d'activité
 * connue. Sans ce repli, ces comptes-là ne seraient jamais purgés, ce qui est
 * exactement l'inverse du but.
 */
async function anonymizeInactiveAccounts(cutoff: Date): Promise<number> {
  const candidates = await prisma.user.findMany({
    where: {
      anonymizedAt: null,
      // Un compte d'administration ne s'anonymise pas tout seul : ce serait
      // perdre l'accès à la boutique pour cause d'inactivité.
      role: 'CUSTOMER',
      OR: [
        { lastSeenAt: { lt: cutoff } },
        { lastSeenAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    // Borne de sécurité : une purge qui traiterait des dizaines de milliers de
    // lignes d'un coup dépasserait le temps d'exécution alloué et échouerait
    // en entier. Le reste passera au tour suivant.
    take: 200,
  })

  let done = 0
  for (const candidate of candidates) {
    await anonymizeUser(candidate.id)
    done += 1
  }

  return done
}
