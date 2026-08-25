import 'server-only'

import { notFound, redirect } from 'next/navigation'

import { AuthorizationError } from './session'

/**
 * Que faire quand `requireAdmin()` refuse.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce module ne fait PAS le contrôle lui-même
 * ---------------------------------------------------------------------------
 * La tentation serait d'écrire un `requireAdminPage()` qui garde et traite d'un
 * seul geste. Ce serait une erreur : `tests/security/middleware-scope.test.ts`
 * exige que chaque page, chaque layout et chaque route sous `admin` appelle
 * `requireAdmin()` LITTÉRALEMENT, et refuse un garde délégué à un utilitaire
 * portant un autre nom.
 *
 * Ce n'est pas une bizarrerie du test : c'est ce qui rend la vérification
 * lisible. Un lecteur qui ouvre une page d'administration voit le contrôle,
 * sans avoir à suivre une indirection pour savoir s'il a lieu.
 *
 * Ce module ne partage donc que le TRAITEMENT du refus — la partie répétitive,
 * dont l'oubli ne crée pas de faille mais des journaux bruyants.
 *
 * ---------------------------------------------------------------------------
 * Deux sorties, et la différence est délibérée
 * ---------------------------------------------------------------------------
 * Pas de session : on renvoie vers la connexion. Le middleware l'aura presque
 * toujours déjà fait ; ce chemin sert au cookie périmé entre-temps.
 *
 * Session valide mais rôle insuffisant : `notFound()`. Pas un écran « accès
 * refusé », qui confirmerait à qui n'y a pas droit qu'une administration vit à
 * cette adresse. C'est le geste déjà retenu pour la tâche planifiée — « 404
 * plutôt que 401 : inutile de confirmer l'existence de la route à qui n'a pas
 * le secret ».
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il faut le faire dans la PAGE aussi, pas seulement le layout
 * ---------------------------------------------------------------------------
 * Le layout traitait déjà le refus, et la page laissait remonter. Résultat
 * observé dans les journaux du serveur : la réponse était bien un 404 — le
 * layout faisait son travail — mais chaque accès refusé inscrivait en plus une
 * `AuthorizationError` non rattrapée, avec sa trace.
 *
 * Ce n'est pas une faille, c'est du bruit. Et du bruit dans un journal
 * d'erreurs a un coût réel : il noie celles qui, elles, demandent une action.
 */
export function handleAdminAuthError(error: unknown, locale: string): never {
  if (error instanceof AuthorizationError) {
    // Les deux refus se distinguent par leur message, seul élément que
    // `AuthorizationError` porte. Un code d'erreur serait plus solide ; il
    // faudrait le poser dans `lib/auth/session.ts`, qui est partagé avec des
    // chemins non administratifs — à faire le jour où un troisième cas
    // apparaît.
    if (error.message.includes('Authentification')) {
      redirect(`/${locale}/connexion?suite=/admin`)
    }
    notFound()
  }

  // Tout le reste — base indisponible, défaut inattendu — remonte à la
  // frontière d'erreur du segment, qui sait l'afficher sans trace technique.
  throw error
}
