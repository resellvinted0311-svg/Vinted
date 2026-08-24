'use server'

import { redirect } from 'next/navigation'

import {
  isMagicCallbackUrl,
  tokenFromCallback,
  writeConfirmation,
} from './magic-link-guard'

/**
 * Confirmation d'un lien de connexion.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * Ce fichier n'exporte QUE cette action, et elle ne fait qu'une chose : poser
 * la preuve qu'un geste humain a eu lieu dans CE navigateur, pour le jeton
 * qu'on lui présente. Elle n'authentifie personne — c'est le rappel d'Auth.js
 * qui s'en charge, une redirection plus loin, et lui seul.
 *
 * Ce qui la rend sûre malgré son caractère public : un POST inter-site ne peut
 * pas la déclencher. Next compare `Origin` et `Host` sur toute Server Action,
 * et le cookie qu'elle pose l'est en `sameSite=lax`. C'est précisément ce que
 * le rappel en GET, lui, n'avait pas.
 *
 * Le paramètre est REVALIDÉ ici, et pas seulement à l'affichage de la page :
 * une action serveur ne peut pas faire confiance à ce que le formulaire qui
 * l'appelle a bien voulu vérifier. Sans ce contrôle, `suite` deviendrait une
 * redirection ouverte signée par notre domaine.
 */
export async function confirmMagicLinkAction(formData: FormData): Promise<void> {
  const suite = formData.get('suite')

  if (typeof suite !== 'string' || !isMagicCallbackUrl(suite)) {
    redirect('/fr/connexion?erreur=lien-invalide')
  }

  const token = tokenFromCallback(new URL(suite))
  if (!token) redirect('/fr/connexion?erreur=lien-invalide')

  await writeConfirmation(token)

  // `redirect` lève : rien de ce qui suit ne s'exécute.
  redirect(suite)
}
