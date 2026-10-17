import 'server-only'

import { after } from 'next/server'
import { runJobNow } from '@/lib/jobs/worker'

/**
 * Pousser des travaux déjà inscrits, une fois la réponse partie.
 *
 * ---------------------------------------------------------------------------
 * Le défaut que ce fichier corrige
 * ---------------------------------------------------------------------------
 * La file est la bonne architecture : un e-mail inscrit dans la transaction
 * part si — et seulement si — la vente est enregistrée, et il se reprend tout
 * seul quand le prestataire d'envoi est indisponible. Rien de cela ne change
 * ici.
 *
 * Ce qui était faux, c'est QUAND il partait. Le plan d'hébergement n'autorise
 * qu'une exécution de tâche planifiée par jour — `vercel.json` l'a fixée à
 * trois heures du matin. Une confirmation de commande encaissée à dix heures
 * partait donc le lendemain à trois heures : dix-sept heures de silence après
 * un paiement par carte. Les commentaires du dépôt affirmaient que l'intervalle
 * du cron était « parfait pour une confirmation de commande » ; ils avaient été
 * écrits en supposant quelques minutes, et ils ont cessé d'être vrais le jour
 * où la planification est passée à une fois par jour.
 *
 * Les offres étaient pires encore, parce qu'elles portent une échéance : une
 * proposition expire en quarante-huit heures. La boutique l'apprenait dix-sept
 * heures après l'avoir reçue — un tiers du délai consommé avant que quiconque
 * ait pu lire le message.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi APRÈS la réponse, et pas simplement avant de rendre
 * ---------------------------------------------------------------------------
 * `after` exécute son rappel une fois la réponse écoulée, et la plateforme
 * garde la fonction en vie pour cela. L'envoi n'entre donc pas dans le temps
 * d'attente de la personne — et, sur le webhook de paiement, pas dans le délai
 * que Stripe chronomètre avant de considérer l'appel en échec et de le
 * rejouer.
 *
 * C'est aussi pour cela qu'on ne lance PAS la promesse sans l'attendre : sur
 * une fonction serverless, le processus est gelé dès la réponse renvoyée, et
 * l'e-mail ne serait jamais parti — sans que personne ne le sache. C'est le
 * troisième piège décrit en tête de `lib/jobs/queue.ts`.
 *
 * ---------------------------------------------------------------------------
 * La file reste la source de vérité
 * ---------------------------------------------------------------------------
 * Ce chemin ACCÉLÈRE, il ne remplace rien. Si `after` n'est pas disponible, si
 * le processus est coupé, si `runJobNow` échoue, le travail est toujours
 * inscrit et le cron le reprendra avec ses reprises. Rien ne se perd ; au pire,
 * on retombe sur le comportement d'avant.
 *
 * C'est la raison pour laquelle cette fonction ne rend rien et ne lève jamais :
 * son échec n'est pas un échec de l'opération qui l'a appelée.
 */
export function pousserApresReponse(jobIds: readonly string[]): void {
  if (jobIds.length === 0) return

  try {
    after(async () => {
      /*
        En SÉRIE, pas en parallèle.

        Les travaux poussés ensemble sont presque toujours deux e-mails du même
        geste — la confirmation à l'acheteuse et l'avis à la boutique. Les
        lancer de front doublerait la pointe d'appels chez le prestataire
        d'envoi pour gagner quelques centaines de millisecondes sur un travail
        que plus personne n'attend : la réponse est déjà partie.

        Chaque travail est enveloppé SÉPARÉMENT.

        `runJobNow` promet de ne pas lever, mais cette promesse est tenue par
        un autre fichier. Si elle était rompue, une boucle nue perdrait tous
        les travaux suivants : le premier e-mail emporterait le second, et la
        boutique ne serait pas prévenue d'une vente parce que la confirmation
        à l'acheteuse avait échoué.

        Et surtout, l'exception remonterait ici, où plus personne ne l'attend —
        donc en `unhandledRejection`, qui tue le processus sur certaines
        plateformes et avec lui les requêtes des autres visiteurs.
      */
      for (const id of jobIds) {
        try {
          await runJobNow(id)
        } catch {
          // Rien à journaliser que la file ne dise déjà : le travail est
          // toujours inscrit, et `runJobs` remontera son échec — avec son
          // compte de reprises — au prochain passage du cron.
        }
      }
    })
  } catch {
    // `after` exige un contexte de requête. Hors de là — un test, un script de
    // maintenance, le cron lui-même — il lève, et c'est sans conséquence : les
    // travaux sont inscrits, et c'est la file qui fait foi. On n'accélère pas,
    // on ne perd rien.
  }
}
