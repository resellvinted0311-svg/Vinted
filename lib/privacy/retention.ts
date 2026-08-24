import 'server-only'

import { prisma } from '@/lib/db/client'
import {
  ABANDONED_ORDER_RETENTION_DAYS,
  ACCOUNTING_RETENTION_DAYS,
  GUEST_DATA_RETENTION_DAYS,
  INACTIVE_ACCOUNT_RETENTION_DAYS,
  WEBHOOK_EVENT_RETENTION_DAYS,
} from '@/lib/config/privacy'
import { MAX_ATTEMPTS } from '@/lib/jobs/queue'
import {
  anonymizeUser,
  anonymizeAbandonedOrders,
  anonymizeExpiredOrders,
} from './anonymize'

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
  /** Négociations sans compte, périmées avec le cookie qui les portait. */
  guestOffers: number
  /**
   * Négociations sans compte ayant servi à une vente : la ligne reste pour la
   * facture, l'adresse et le jeton s'en vont.
   */
  strippedSoldOffers: number
  /** Traces d'événements de paiement, périmées. */
  webhookEvents: number
  /** Travaux différés terminés OU définitivement en échec, périmés. */
  finishedJobs: number
  /** Tunnels jamais payés, vidés de leurs coordonnées. */
  anonymizedAbandonedOrders: number
  /** Commandes payées dont les dix ans comptables sont écoulés. */
  anonymizedExpiredOrders: number
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
  const accountingCutoff = daysAgo(ACCOUNTING_RETENTION_DAYS, now)
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

  // Offres déposées sans compte. Elles portent une adresse e-mail et un jeton
  // de session : deux données personnelles, rattachées à un cookie dont la
  // durée de vie est de trente jours. Passé ce délai, la personne concernée ne
  // peut plus retrouver sa propre négociation — la conserver ne lui sert donc
  // à rien, et la garder nous exposerait pour rien.
  //
  // Une offre rattachée à une commande PAYÉE est ÉPARGNÉE : elle justifie le
  // prix porté sur une facture, et suit alors la durée comptable. La supprimer
  // laisserait un montant négocié inexplicable sur une pièce comptable.
  //
  // ---------------------------------------------------------------------------
  // Le défaut que la condition ci-dessous corrige
  // ---------------------------------------------------------------------------
  // Elle disait `orderItems: { none: {} }` : « aucune ligne de commande ». Or
  // `OrderItem.offerId` est écrit à la CRÉATION de la commande, avant tout
  // paiement (`lib/shop/checkout.ts`). Une offre qui a seulement servi à
  // afficher un prix dans un tunnel abandonné avait donc une ligne de commande,
  // et sortait définitivement du champ de la purge.
  //
  // Le résultat était le contraire de ce qui est annoncé : trente jours plus
  // tard, `anonymizeAbandonedOrders` vidait consciencieusement l'e-mail et
  // l'adresse de la commande abandonnée — et l'adresse e-mail restait, juste à
  // côté, dans `Offer.guestEmail`, avec le jeton du navigateur qui l'avait
  // déposée. Pour toujours.
  //
  // La bonne frontière n'est pas « une commande existe » mais « une PIÈCE
  // COMPTABLE existe » : c'est `paidAt`, comme partout ailleurs dans ce
  // fichier. Un tunnel abandonné n'en est pas une.
  const guestOffers = await prisma.offer.deleteMany({
    where: {
      userId: null,
      createdAt: { lt: guestCutoff },
      orderItems: { none: { order: { paidAt: { not: null } } } },
    },
  })

  // Les offres d'invité qui, elles, ont bien servi à une vente gardent leur
  // montant — la facture s'appuie dessus — mais n'ont aucun besoin de garder
  // l'ADRESSE et le JETON de celle qui a négocié. La commande porte déjà
  // l'identité de l'acheteuse, et elle est anonymisée à l'échéance comptable
  // par `anonymizeExpiredOrders`. Ces deux colonnes-là ne le seraient jamais.
  //
  // On vide plutôt qu'on ne supprime : la ligne reste, le lien avec la
  // personne part.
  const strippedSoldOffers = await prisma.offer.updateMany({
    where: {
      userId: null,
      createdAt: { lt: guestCutoff },
      OR: [{ guestEmail: { not: null } }, { guestSessionToken: { not: null } }],
    },
    data: { guestEmail: null, guestSessionToken: null },
  })

  // Traces d'événements de paiement. Elles sont déjà caviardées à l'écriture
  // — voir lib/payments/webhook-payload.ts — mais une trace technique qui ne
  // sert plus n'a pas à survivre pour autant. Effacer ne rouvre pas la porte
  // au rejeu : la signature Stripe porte un horodatage et refuse l'ancien.
  const webhookEvents = await prisma.webhookEvent.deleteMany({
    where: { createdAt: { lt: webhookCutoff } },
  })

  // Travaux différés TERMINÉS. Leur contenu ne porte qu'un identifiant de
  // commande — c'est délibéré, le travail relit la commande au moment de
  // s'exécuter — mais un identifiant reste un identifiant indirect, et une
  // table qui ne se vide jamais finit par tout garder.
  //
  // Deux sorts, et il en manquait un.
  //
  // Les travaux TERMINÉS partent, c'était déjà le cas. Un travail en échec
  // reste visible tant qu'il peut être repris ou compris — c'était la raison
  // invoquée pour les épargner tous.
  //
  // Mais « tant qu'il peut être repris » a une fin : `claimJobs` refuse de
  // reprendre au-delà du plafond (`attempts < MAX_ATTEMPTS`). Un travail qui a
  // brûlé ses six tentatives ne sera jamais repris, ne sera donc jamais marqué
  // terminé, et n'était effacé par rien. Une panne du prestataire d'e-mail au
  // mauvais moment laissait ainsi, pour toujours, une ligne désignant la
  // commande d'une personne et un message d'erreur du prestataire — alors que
  // le registre et la page publique annoncent trente jours.
  //
  // On leur laisse la même durée qu'aux autres traces techniques : le temps de
  // comprendre la panne, pas davantage.
  const finishedJobs = await prisma.job.deleteMany({
    where: {
      OR: [
        // Inchangé : c'est la date de FIN qui compte pour un travail terminé.
        { completedAt: { not: null, lt: webhookCutoff } },
        // Nouveau. Un travail épuisé n'a pas de date de fin — il n'a jamais
        // fini. On date donc sa dernière ÉCHÉANCE : `failJob` repousse `runAt`
        // à chaque échec, donc elle porte le dernier moment où ce travail
        // devait encore servir à quelque chose. C'est aussi la colonne que
        // l'index de la table porte en tête.
        { attempts: { gte: MAX_ATTEMPTS }, runAt: { lt: webhookCutoff } },
      ],
    },
  })

  // Tunnels de commande jamais payés. On vide, on ne supprime pas : un
  // paiement a pu aboutir sans que le webhook nous parvienne, et la ligne est
  // alors la seule trace d'un débit à retrouver.
  const anonymizedAbandonedOrders =
    await anonymizeAbandonedOrders(abandonedOrderCutoff)

  // Commandes payées dont l'obligation comptable est éteinte. La déclaration
  // publique annonçait dix ans et rien ne les appliquait : une durée sans
  // mécanisme est une déclaration fausse.
  const anonymizedExpiredOrders = await anonymizeExpiredOrders(accountingCutoff)

  const anonymizedAccounts = await anonymizeInactiveAccounts(inactiveCutoff)

  return {
    expiredSessions: expiredSessions.count,
    expiredVerificationTokens: expiredVerificationTokens.count,
    expiredUserTokens: expiredUserTokens.count,
    guestFavorites: guestFavorites.count,
    abandonedGuestCarts: abandonedGuestCarts.count,
    guestOffers: guestOffers.count,
    strippedSoldOffers: strippedSoldOffers.count,
    webhookEvents: webhookEvents.count,
    finishedJobs: finishedJobs.count,
    anonymizedAbandonedOrders,
    anonymizedExpiredOrders,
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
