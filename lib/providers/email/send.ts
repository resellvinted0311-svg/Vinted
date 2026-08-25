import 'server-only'

/**
 * Transport d'e-mail.
 *
 * Un seul endroit sait comment un message part. Le lien de connexion l'avait
 * inscrit chez lui ; la confirmation de commande allait le recopier. Deux
 * copies d'un appel réseau, ce sont deux façons de traiter une panne, deux
 * façons de masquer une adresse dans un journal, et une seule des deux qui
 * sera corrigée le jour où il faudra.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module ne décide pas
 * ---------------------------------------------------------------------------
 * Ni le contenu, ni la langue, ni l'opportunité d'envoyer. Il reçoit un
 * message fini et le remet au prestataire — ou lève. C'est l'appelant, ou la
 * file de travaux, qui décide ce qu'on fait d'un échec.
 */

export interface EmailMessage {
  to: string
  subject: string
  /** Toujours fournie : certains clients de messagerie n'affichent que celle-ci. */
  text: string
  html: string
  /** Adresse de réponse, quand elle diffère de l'expéditeur. */
  replyTo?: string
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('RESEND_API_KEY et EMAIL_FROM sont requis pour envoyer un e-mail.')
    this.name = 'EmailNotConfiguredError'
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

/**
 * Masque une adresse destinée à un journal.
 *
 * En développement, la base pointe parfois sur des données réelles, et une
 * console se partage — capture d'écran, session à deux, fichier de log ramassé
 * par un outil. Une donnée personnelle n'a pas à s'y trouver.
 *
 * Ce principe ne valait rien tant que le corps du message était imprimé juste
 * en dessous : il porte le nom et l'adresse postale. Le corps est donc masqué
 * lui aussi, sauf demande explicite.
 */
export function maskAddress(address: string): string {
  const [local = '', domain = ''] = address.split('@')
  const head = local.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`
}

/**
 * Envoie un message, ou lève.
 *
 * Sans clé, et UNIQUEMENT en développement, le message est résumé dans la
 * console : la boutique reste démontrable de bout en bout sans dépendance
 * externe. Partout ailleurs — production, aperçu, intégration continue —
 * l'absence de clé est une erreur franche. Un e-mail qu'on croit parti et qui
 * n'est jamais parti est pire qu'une erreur.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== 'development') {
      throw new EmailNotConfiguredError()
    }

    // Le CORPS est masqué par défaut, et c'était le vrai trou : masquer
    // l'adresse du destinataire puis imprimer le message entier juste en
    // dessous ne protège rien du tout. Une confirmation de commande contient
    // le nom, la rue, le code postal et la ville — c'est-à-dire tout ce que
    // l'adresse masquée était censée soustraire.
    //
    // L'afficher reste possible, mais devient un geste délibéré : c'est la
    // différence entre une console qu'on peut partager sans y penser et une
    // console qu'on sait chargée.
    const showBody = process.env.EMAIL_DEV_SHOW_BODY === '1'

    // Volontairement `console.info` et non le journal structuré : cet
    // encadré n'est lu que par un humain, dans un terminal, en
    // développement. Une ligne JSON serait illisible là où c'est
    // précisément la lisibilité qu'on cherche — et rien ici ne part vers
    // un collecteur, puisque le chemin est fermé hors développement.

    console.info(
      [
        '',
        '─────────────────────────────────────────────',
        ' E-mail (mode développement, non envoyé)',
        ` Destinataire : ${maskAddress(message.to)}`,
        ` Objet        : ${message.subject}`,
        '─────────────────────────────────────────────',
        showBody
          ? message.text
          : ` Corps masqué (${message.text.length} caractères).\n` +
            ' EMAIL_DEV_SHOW_BODY=1 pour l’afficher — il contient le nom et\n' +
            ' l’adresse postale de la personne.',
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
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  })

  if (!response.ok) {
    // Le corps de la réponse peut contenir l'adresse : on ne le recopie pas.
    throw new Error(`Envoi refusé par Resend (${response.status}).`)
  }
}
