import 'server-only'

import { SITE } from '@/lib/config/site'

/**
 * Masque une adresse pour la console de développement.
 *
 * Le journal affichait l'adresse en clair. En développement, la base pointe
 * parfois sur des données réelles, et une console se partage — capture
 * d'écran, session en binôme, fichier de log ramassé par un outil. Une donnée
 * personnelle n'a pas à s'y trouver pour que le lien soit utilisable.
 */
function maskAddress(address: string): string {
  const [local = '', domain = ''] = address.split('@')
  const head = local.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`
}

/**
 * L'URL de rappel pointe-t-elle bien chez nous ?
 *
 * `trustHost: true` laisse Auth.js construire ses URL depuis l'en-tête Host de
 * la requête. Vercel normalise cet en-tête, donc le vecteur est fermé — mais
 * il repose entièrement sur une variable d'environnement bien posée et sur le
 * comportement d'un hébergeur. C'est beaucoup de conditions pour un lien
 * signé par notre domaine que la personne va cliquer sans réfléchir.
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
 * Sans clé Resend, en développement uniquement, le lien est écrit dans la
 * console : la connexion reste démontrable de bout en bout sans dépendance
 * externe. Partout ailleurs, l'absence de clé est une erreur franche plutôt
 * qu'un échec silencieux.
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

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!apiKey || !from) {
    // La condition portait sur `production` seulement : un aperçu Vercel ou un
    // environnement de test écrivait donc l'adresse et le lien en clair dans
    // ses journaux. On inverse — la console n'est un repli QU'en développement.
    if (process.env.NODE_ENV !== 'development') {
      throw new Error(
        'RESEND_API_KEY et EMAIL_FROM sont requis pour envoyer un lien de connexion.',
      )
    }

    console.info(
      [
        '',
        '─────────────────────────────────────────────',
        ' Lien de connexion (mode développement)',
        ` Destinataire : ${maskAddress(to)}`,
        ` Expire le    : ${expires.toISOString()}`,
        ` Lien         : ${url}`,
        '─────────────────────────────────────────────',
        '',
      ].join('\n'),
    )
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: 'Votre lien de connexion',
      // Gabarit React Email complet en Phase 6 ; ici le strict nécessaire,
      // avec sa version texte.
      text: `Pour vous connecter, ouvrez ce lien : ${url}\n\nIl expire le ${expires.toISOString()}.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
      html: `<p>Pour vous connecter, ouvrez ce lien :</p><p><a href="${url}">Se connecter</a></p><p>Il expire le ${expires.toISOString()}.</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Envoi du lien de connexion refusé par Resend (${response.status}).`,
    )
  }
}
