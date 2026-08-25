import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Plancher de temps sur une réponse.
 *
 * ---------------------------------------------------------------------------
 * Le défaut concret que ce module ferme
 * ---------------------------------------------------------------------------
 * « Mot de passe oublié » répond exactement la même phrase que le compte
 * existe ou non. C'est la règle tenue partout ailleurs dans
 * l'authentification, et elle est écrite en toutes lettres en tête de
 * `lib/auth/password-reset-actions.ts`.
 *
 * Elle ne servait pourtant à rien, parce que la réponse ne mettait pas le même
 * TEMPS à arriver :
 *
 *  - adresse inconnue → une lecture, et on rend la main. Quelques
 *    millisecondes ;
 *  - adresse connue → une transaction, puis l'attente d'un aller-retour vers
 *    le prestataire d'e-mail. Deux à cinq cents millisecondes de plus.
 *
 * Un écart de cet ordre se mesure depuis n'importe quelle connexion, sans
 * outil particulier et sans répétition savante. Le message uniforme devenait
 * décoratif : le chronomètre répondait à la question que la phrase refusait de
 * traiter, et la liste des comptes de la boutique redevenait énumérable
 * adresse par adresse.
 *
 * ---------------------------------------------------------------------------
 * Un plancher FIXE, surtout pas un délai tiré au hasard
 * ---------------------------------------------------------------------------
 * L'idée d'ajouter un délai aléatoire vient tout de suite, et elle est fausse.
 * Le hasard ne supprime pas l'écart : il l'enfouit dans du bruit, et le bruit
 * se moyenne. Qui répète la mesure mille fois retrouve la différence des
 * moyennes intacte — il lui aura simplement fallu mille mesures au lieu de
 * dix. Un plancher fixe, lui, rend la durée observée CONSTANTE tant que le
 * travail tient dessous : il n'y a plus de moyenne à comparer, parce qu'il n'y
 * a plus de variable.
 *
 * ---------------------------------------------------------------------------
 * Ce n'est que la SECONDE ligne de défense
 * ---------------------------------------------------------------------------
 * Un plancher ne masque que ce qui passe dessous. Tant qu'un appel réseau
 * restait dans le chemin de réponse, il suffisait d'une lenteur du prestataire
 * pour que la branche lente dépasse le plancher et rouvre l'écart — et cela
 * arriverait précisément le jour où le prestataire va mal, c'est-à-dire au
 * moment où personne ne regarde.
 *
 * La protection de fond est donc ailleurs : l'envoi a été sorti du chemin de
 * réponse et confié à la file de travaux. Ce qui reste sous le plancher n'est
 * plus qu'une poignée d'allers-retours de base de données, dont la durée est
 * bornée et connue. Le plancher absorbe ce résidu ; il ne porte pas la
 * garantie à lui seul.
 */
export async function withTimeFloor<T>(
  floorMs: number,
  work: () => Promise<T>,
): Promise<T> {
  // Horloge MONOTONE, jamais `Date.now()`. Une horloge murale recule quand le
  // système se resynchronise : un rattrapage NTP au milieu de la requête ferait
  // calculer un temps écoulé négatif, donc un plancher déjà atteint, donc aucun
  // rembourrage — et l'écart redeviendrait visible sans que rien ne le signale.
  const started = process.hrtime.bigint()

  try {
    return await work()
  } finally {
    // Dans `finally`, et non après le `return` : une exception qui remonte doit
    // être rembourrée elle aussi. Une branche qui ÉCHOUE vite renseigne autant
    // qu'une branche qui réussit vite — c'est le même oracle, par l'autre bout.
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
    const remainingMs = floorMs - elapsedMs
    if (remainingMs > 0) await sleep(remainingMs)
  }
}
