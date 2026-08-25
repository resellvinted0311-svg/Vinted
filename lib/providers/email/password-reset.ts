import 'server-only'

import { SITE } from '@/lib/config/site'
import { sendEmail } from './send'

/**
 * L'e-mail de réinitialisation de mot de passe.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'il dit, et ce qu'il ne dit pas
 * ---------------------------------------------------------------------------
 * Il ne porte NI le prénom, NI l'adresse du compte, NI aucune donnée de la
 * personne. Un e-mail est réexpédié, transféré, laissé ouvert sur un écran —
 * et surtout, il peut arriver dans une boîte qui n'est pas la bonne : une
 * adresse recopiée de travers dans le formulaire de demande suffit. Ce qu'il
 * contient doit rester sans valeur pour qui le reçoit par erreur.
 *
 * Il dit en revanche explicitement quoi faire si l'on n'a rien demandé : ne
 * rien faire. C'est la seule bonne consigne — inviter à « signaler » enverrait
 * les gens cliquer sur un second lien dans un message dont ils doutent déjà.
 */

/**
 * L'URL pointe-t-elle bien chez nous ?
 *
 * Même contrôle que pour le lien magique, et pour la même raison : l'URL est
 * construite à partir de la configuration du site, mais un lien signé par notre
 * domaine sera cliqué sans réfléchir. Vérifier l'origine ne dépend d'aucun
 * en-tête et d'aucun hébergeur.
 */
function pointsToThisShop(url: string): boolean {
  try {
    return new URL(url).origin === new URL(SITE.url).origin
  } catch {
    return false
  }
}

export async function sendPasswordResetEmail({
  to,
  url,
  expires,
}: {
  to: string
  url: string
  expires: Date
}): Promise<void> {
  if (!pointsToThisShop(url)) {
    throw new Error(
      'Lien de réinitialisation refusé : son origine ne correspond pas à celle de la boutique.',
    )
  }

  const deadline = expires.toISOString()

  await sendEmail({
    to,
    subject: 'Réinitialiser votre mot de passe',
    text: [
      `Une réinitialisation de mot de passe a été demandée pour votre compte ${SITE.name}.`,
      '',
      'Ouvrez ce lien pour en choisir un nouveau :',
      url,
      '',
      `Il expire le ${deadline}.`,
      '',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message :",
      'votre mot de passe actuel reste valable et rien ne change.',
    ].join('\n'),
    html: [
      `<p>Une réinitialisation de mot de passe a été demandée pour votre compte ${SITE.name}.</p>`,
      '<p>Ouvrez ce lien pour en choisir un nouveau :</p>',
      `<p><a href="${url}">${url}</a></p>`,
      `<p>Il expire le ${deadline}.</p>`,
      "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : " +
        'votre mot de passe actuel reste valable et rien ne change.</p>',
    ].join(''),
  })
}
