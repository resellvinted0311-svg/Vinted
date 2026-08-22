import 'server-only'

import { SITE } from '@/lib/config/site'
import { sendEmail } from './send'

/**
 * L'URL de rappel pointe-t-elle bien chez nous ?
 *
 * `trustHost: true` laisse Auth.js construire ses URL depuis l'en-tête Host de
 * la requête. Vercel normalise cet en-tête, donc le vecteur est fermé — mais
 * il repose entièrement sur une variable d'environnement bien posée et sur le
 * comportement d'un hébergeur. C'est beaucoup de conditions pour un lien signé
 * par notre domaine que la personne va cliquer sans réfléchir.
 *
 * On vérifie donc l'origine avant d'envoyer, ce qui ne dépend de rien d'autre.
 */
function pointsToThisShop(url: string): boolean {
  try {
    return new URL(url).origin === new URL(SITE.url).origin
  } catch {
    return false
  }
}

/**
 * Envoi du lien de connexion.
 *
 * Le transport vit dans `send.ts` : sans clé et en développement uniquement,
 * le message est résumé dans la console, adresse masquée. Partout ailleurs,
 * l'absence de clé est une erreur franche plutôt qu'un échec silencieux.
 */
export async function sendMagicLinkEmail({
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
      'Lien de connexion refusé : son origine ne correspond pas à celle de la boutique.',
    )
  }

  const deadline = expires.toISOString()

  await sendEmail({
    to,
    subject: 'Votre lien de connexion',
    text: [
      `Pour vous connecter à ${SITE.name}, ouvrez ce lien :`,
      url,
      '',
      `Il expire le ${deadline}.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ].join('\n'),
    html: [
      `<p>Pour vous connecter à ${SITE.name}, ouvrez ce lien :</p>`,
      `<p><a href="${url}">Se connecter</a></p>`,
      `<p>Il expire le ${deadline}.</p>`,
      "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>",
    ].join(''),
  })
}
