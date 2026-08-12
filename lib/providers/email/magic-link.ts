import 'server-only'

/**
 * Envoi du lien de connexion.
 *
 * Sans clé Resend (développement), le lien est écrit dans la console du
 * serveur : la connexion reste démontrable de bout en bout sans dépendance
 * externe. En production, l'absence de clé est une erreur franche plutôt
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
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'RESEND_API_KEY et EMAIL_FROM sont requis pour envoyer un lien de connexion.',
      )
    }

    console.info(
      [
        '',
        '─────────────────────────────────────────────',
        ' Lien de connexion (mode développement)',
        ` Destinataire : ${to}`,
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
