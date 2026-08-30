import 'server-only'

import { prisma } from '@/lib/db/client'
import { getAutoDropSchedule } from '@/lib/config/settings'
import {
  computeAutoDropPriceCents,
  dueDropStage,
  DAY_MS,
  type AutoDropStage,
} from '@/lib/domain/pricing'
import { enqueueSyncEvents } from '@/lib/sync/outbound'

/**
 * Baisse automatique des prix — le balayage.
 *
 * Le barème vit dans `Setting.autoDropSchedule` et le calcul dans
 * `lib/domain/pricing.ts` ; ce module ne fait qu'appliquer, aux pièces dues,
 * le prix que le barème prescrit.
 *
 * ---------------------------------------------------------------------------
 * La base du pourcentage est le prix d'ORIGINE
 * ---------------------------------------------------------------------------
 * `comparePriceCents ?? priceCents`. Après une première baisse, le prix
 * d'origine survit dans le prix barré : le palier suivant se calcule dessus,
 * jamais en cascade sur le prix déjà baissé — un barème « −10 % puis −20 % »
 * promet −20 % au total, pas −28 %.
 *
 * Cas limite assumé : une pièce importée avec un prix barré fourni par
 * l'application de gestion (« était à 50 €, affichée 40 € ») prend ce barré
 * pour base. Si la remise déjà consentie dépasse le palier dû, le calcul rend
 * un prix AU-DESSUS du prix affiché — et la garde « uniquement vers le bas »
 * ci-dessous ne l'applique pas. Une pièce déjà remisée à −20 % n'a pas à
 * redescendre : le barème plafonne à −20 %.
 *
 * ---------------------------------------------------------------------------
 * Une baisse écrêtée sans effet n'écrit RIEN
 * ---------------------------------------------------------------------------
 * Le plancher peut absorber toute la baisse (`computeAutoDropPriceCents`
 * écrête). Écrire quand même `lastPriceDropAt` ferait remonter la pièce dans
 * le tri « dernières baisses » sans qu'aucun prix n'ait bougé — exactement la
 * fausse urgence que le brief interdit — et poser un prix barré égal au prix
 * violerait l'invariant qui rend une remise affichable (L112-1-1 : le prix de
 * référence doit être supérieur ET avoir été pratiqué).
 *
 * ---------------------------------------------------------------------------
 * Ce que le balayage ne touche jamais
 * ---------------------------------------------------------------------------
 * Les pièces RESERVED : quelqu'un est à l'étape du paiement. Les montants de
 * sa commande sont déjà figés — rien ne casserait — mais changer le prix
 * affiché sous ses yeux pendant qu'il paie est une goujaterie gratuite. La
 * réservation expire en quelques minutes ; le balayage suivant la rattrape.
 *
 * SOLD est figé (son prix est sur une facture), DRAFT et SCHEDULED n'ont pas
 * d'âge (`publishedAt` nul). Et `autoDropEnabled` reste souverain pièce par
 * pièce : une pièce rare peut attendre son prix indéfiniment.
 */

/**
 * Applique les baisses dues. Renvoie le nombre de pièces baissées.
 *
 * ---------------------------------------------------------------------------
 * Une transaction PAR PIÈCE, pas une pour le lot
 * ---------------------------------------------------------------------------
 * Chaque baisse est indépendante — l'écriture conditionnelle la rend sûre à
 * l'unité — et les regrouper dans une transaction unique aurait deux défauts,
 * tous deux au pire moment (l'activation du barème sur un catalogue ancien,
 * quand des dizaines de pièces sont dues d'un coup) :
 *
 *  - la transaction interactive a un délai maximal ; le dépasser annule TOUT,
 *    et chaque passage suivant remourrait à l'identique ;
 *  - en production la connexion est unique (`connection_limit=1`) : une
 *    longue transaction affamerait les cinq autres travaux du cron.
 *
 * À l'unité, une panne au milieu du lot ne perd rien : ce qui est écrit est
 * écrit avec sa remontée, le reste est rattrapé au passage suivant.
 *
 * ---------------------------------------------------------------------------
 * Idempotent, et sûr sous deux crons qui se chevauchent
 * ---------------------------------------------------------------------------
 * L'écriture est conditionnelle : `WHERE priceCents = <valeur lue>` — et
 * `minOfferCents = <valeur lue>` aussi, puisque son retrait se décide sur
 * cette lecture ; sans cette clause, un seuil que le vendeur vient de
 * corriger en back-office serait effacé sur la foi d'une valeur périmée. Un
 * second passage recalcule le même prix cible, trouve `target >= priceCents`,
 * et ne touche à rien ; un passage réellement concurrent perd la course sur
 * le WHERE, et l'événement de synchronisation n'est inscrit que pour le
 * gagnant.
 *
 * ---------------------------------------------------------------------------
 * L'événement part avec le prix d'AVANT
 * ---------------------------------------------------------------------------
 * `previousPriceCents` est capturé avant l'écriture — une fois la baisse
 * écrite, il n'existe plus nulle part (le prix barré porte l'origine, pas le
 * prix intermédiaire). `occurredAt` est figé à l'instant du balayage : c'est
 * la clé d'idempotence côté application de gestion, une reprise de la file ne
 * doit pas passer pour une seconde baisse.
 *
 * L'inscription se fait DANS la transaction de l'écriture : une baisse écrite
 * sans remontée serait annulée au prochain import — l'application, source de
 * vérité de l'inventaire, réécrirait le prix qu'elle connaît.
 *
 * ---------------------------------------------------------------------------
 * `schedule` en paramètre, comme `policy` sur les offres
 * ---------------------------------------------------------------------------
 * Les tests fournissent le barème sans toucher à la table Setting, que les
 * autres fichiers de test lisent en parallèle. En production, personne ne le
 * passe : il vient de la base. Un barème VIDE désactive le balayage — c'est
 * une valeur explicite, pas une clé absente (qui, elle, lève).
 */
export async function applyDuePriceDrops(
  now = new Date(),
  schedule?: AutoDropStage[],
): Promise<number> {
  const stages = schedule ?? (await getAutoDropSchedule())
  if (stages.length === 0) return 0

  const firstStageDays = Math.min(...stages.map((stage) => stage.days))
  const oldEnough = new Date(now.getTime() - firstStageDays * DAY_MS)

  // Toutes les candidates, sans borne : les pièces déjà au bon prix repassent
  // ici à chaque balayage et ne coûtent que quelques entiers. Une borne les
  // ferait au contraire occuper le lot en tête de tri, et la première pièce
  // au-delà de la borne ne serait JAMAIS baissée.
  const candidates = await prisma.article.findMany({
    where: {
      status: 'AVAILABLE',
      autoDropEnabled: true,
      publishedAt: { not: null, lte: oldEnough },
    },
    select: {
      id: true,
      publishedAt: true,
      priceCents: true,
      comparePriceCents: true,
      floorPriceCents: true,
      minOfferCents: true,
      externalId: true,
    },
    orderBy: { publishedAt: 'asc' },
  })

  let dropped = 0

  for (const article of candidates) {
    if (!article.publishedAt) continue

    const stage = dueDropStage(stages, article.publishedAt, now)
    if (!stage) continue

    const base = article.comparePriceCents ?? article.priceCents
    const target = computeAutoDropPriceCents({
      basePriceCents: base,
      floorPriceCents: article.floorPriceCents,
      percent: stage.percent,
    })

    // Uniquement vers le bas, strictement : à égalité il n'y a pas de
    // baisse, et au-dessus il n'y en a jamais — un balayage qui remonte un
    // prix n'est plus une baisse automatique, c'est une surprise.
    if (target >= article.priceCents) continue

    const applied = await prisma.$transaction(async (tx) => {
      const written = await tx.article.updateMany({
        where: {
          id: article.id,
          status: 'AVAILABLE',
          autoDropEnabled: true,
          priceCents: article.priceCents,
          minOfferCents: article.minOfferCents,
        },
        data: {
          priceCents: target,
          // Le prix barré porte l'ORIGINE : `base` vaut déjà l'ancien barré
          // quand il existe, et l'ancien prix affiché sinon. Dans les deux
          // cas il est strictement supérieur au nouveau prix — la garde
          // ci-dessus l'assure — donc la remise reste affichable.
          comparePriceCents: base,
          lastPriceDropAt: now,
          // Un seuil de refus automatique rattrapé par la baisse fermerait la
          // négociation en silence : toute offre possible (< prix affiché)
          // serait sous le seuil, auto-refusée, en brûlant tentatives et
          // carences. Un seuil qui refuse tout n'est plus un seuil : on le
          // retire, et le vendeur retrouve la décision.
          ...(article.minOfferCents !== null && article.minOfferCents >= target
            ? { minOfferCents: null }
            : {}),
        },
      })

      // Zéro ligne : quelqu'un — un balayage concurrent, une vente, un import
      // de synchronisation, un réglage du vendeur — a écrit entre la lecture
      // et l'écriture. La pièce sera rejugée au prochain passage, sur son
      // nouvel état.
      if (written.count === 0) return false

      // Même filtre que dans `enqueueSyncEvents` : une pièce née ici n'a
      // personne à prévenir. Le refaire avant l'appel épargne à la
      // transaction une relecture dont l'issue est connue d'avance.
      if (article.externalId !== null) {
        await enqueueSyncEvents(tx, {
          event: 'article.price_dropped',
          articleIds: [article.id],
          occurredAt: now,
          previousPriceCents: article.priceCents,
        })
      }

      return true
    })

    if (applied) dropped += 1
  }

  return dropped
}
