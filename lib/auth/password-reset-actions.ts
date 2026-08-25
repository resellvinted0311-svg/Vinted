'use server'

import { after } from 'next/server'

import { prisma } from '@/lib/db/client'
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '@/lib/validation/auth'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
import { mailboxIdentity } from '@/lib/security/mail-identity'
import { withTimeFloor } from '@/lib/security/timing'
import { isAuthConfigured } from '@/lib/config/site'
import { enqueue } from '@/lib/jobs/queue'
import { runJobNow } from '@/lib/jobs/worker'
import { consumePasswordReset, logResetRequested } from './password-reset'
import { createDatabaseSession } from './session'
import { adoptGuestSession } from '@/lib/shop/handover'

/**
 * Réinitialisation de mot de passe — les deux actions serveur.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. Ce module n'exporte que les deux gestes destinés à l'être, et rien
 * de ce qui touche `UserToken` ne transite par ici — c'est
 * `lib/auth/password-reset.ts` qui le fait, et il n'est pas une action.
 *
 * ---------------------------------------------------------------------------
 * La réponse est la MÊME que le compte existe ou non — le DÉLAI aussi
 * ---------------------------------------------------------------------------
 * C'est la règle déjà tenue par la connexion et par le lien magique. La
 * respecter ici demande de la tenir jusqu'au bout, y compris dans les cas
 * qu'on n'a pas envie de traiter :
 *
 *  - adresse inconnue → même réponse, même délai apparent ;
 *  - compte anonymisé → même réponse, et aucun e-mail : poser un mot de passe
 *    sur une pierre tombale la ferait revivre ;
 *  - compte sans mot de passe (créé par lien magique) → un mot de passe EST
 *    posé, et c'est voulu. Refuser dirait « ce compte existe mais sans mot de
 *    passe », ce qui en apprend plus que de ne rien dire. Et la personne est
 *    bien la titulaire de la boîte, puisqu'elle a reçu le lien ;
 *  - plafond de débit atteint → même réponse. Refuser plus explicitement ici
 *    rétablirait l'oracle que le message uniforme ferme.
 *
 * L'inscription, elle, révèle toujours l'existence d'un compte — c'est une
 * décision assumée, écrite dans DEPLOY.md. Ce n'est pas une raison d'ouvrir
 * une seconde porte : la première a un coût de conversion qui la justifie,
 * celle-ci n'en aurait aucun.
 *
 * Et la phrase uniforme ne suffit PAS. Elle était tenue, mot pour mot, pendant
 * que le chronomètre disait le contraire : une adresse inconnue s'arrêtait
 * après une lecture, une adresse connue ouvrait une transaction puis attendait
 * un aller-retour vers le prestataire d'e-mail — deux à cinq cents
 * millisecondes de plus, mesurables depuis n'importe quelle connexion. La
 * boutique redevenait énumérable adresse par adresse, sans qu'aucun message ne
 * l'avoue.
 *
 * Deux gestes ferment cela, et ils ne sont pas interchangeables :
 *
 *  1. l'envoi SORT du chemin de réponse — il est inscrit en file de travaux,
 *     et l'action ne fait plus qu'écrire une ligne. C'est la protection de
 *     fond : il n'y a plus d'appel réseau dont la lenteur pourrait dépasser
 *     n'importe quel rembourrage ;
 *  2. un plancher de temps commun couvre le résidu — la poignée
 *     d'allers-retours de base qui distingue encore les deux branches.
 *
 * Le premier sans le second laisserait un écart de quelques millisecondes,
 * mesurable en accumulant les essais — six, mesurées sur cette base. Le second
 * sans le premier céderait le jour où le prestataire d'e-mail ralentit.
 */

export type PasswordResetState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  /** Volontairement indistinct de l'échec : voir l'en-tête. */
  | { status: 'sent' }
  | { status: 'done' }

/**
 * Plancher de temps de la réponse, en millisecondes.
 *
 * ---------------------------------------------------------------------------
 * Comment cette valeur est choisie
 * ---------------------------------------------------------------------------
 * Elle doit dépasser confortablement le travail que l'action fait réellement —
 * deux compteurs de débit, une lecture, une écriture de file : six
 * millisecondes, mesurées — et rester imperceptible pour la personne qui vient
 * de cliquer.
 *
 * Ce n'est PAS un chiffre à ajuster jusqu'à ce que les mesures se ressemblent :
 * si le travail venait à dépasser ce plancher, l'écart réapparaîtrait, et
 * l'augmenter ne ferait que repousser le problème. Ce qui garantit la
 * propriété, c'est qu'aucun appel réseau ne subsiste dans le chemin de réponse.
 * Le plancher n'absorbe que le résidu.
 */
const RESPONSE_FLOOR_MS = 500

/**
 * Demande d'un lien de réinitialisation.
 *
 * Le corps est dans une fonction NON exportée : dans un fichier `'use server'`,
 * un export est une adresse HTTP publique, et rien ne justifierait d'en ouvrir
 * une seconde qui contournerait le plancher.
 */
export async function requestPasswordResetAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  return withTimeFloor(RESPONSE_FLOOR_MS, () => requestPasswordReset(formData))
}

async function requestPasswordReset(
  formData: FormData,
): Promise<PasswordResetState> {
  // Sans secret de signature, la session qui suivra la réinitialisation ne
  // vaudrait rien : la personne poserait un mot de passe puis se retrouverait
  // déconnectée sans comprendre. Mieux vaut ne rien écrire et le dire.
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get('email'),
    locale: formData.get('locale'),
  })
  if (!parsed.success) return { status: 'error', messageKey: 'invalidEmail' }

  const byOrigin = await checkRateLimit({
    key: `password-reset:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!byOrigin) return { status: 'error', messageKey: 'rateLimited' }

  // Compter par empreinte d'appelant SEULEMENT laisserait une porte ouverte :
  // un parc de sorties suffirait à noyer la boîte d'une personne ciblée sous
  // des courriels légitimement signés par notre domaine. Le coût ne serait pas
  // pour elle seule — plaintes pour spam chez le prestataire, mise en
  // quarantaine de l'adresse d'envoi, et plus aucun e-mail transactionnel
  // délivré à personne.
  //
  // Le compteur porte sur un JETON, jamais sur l'adresse en clair : la clé
  // part chez un tiers.
  const byAddress = await checkRateLimit({
    key: `password-reset-mail:${pseudonymize({
      purpose: 'rate-limit:password-reset-email',
      value: mailboxIdentity(parsed.data.email),
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!byAddress) return { status: 'sent' }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, anonymizedAt: true },
  })

  // Inconnue, ou effacée : on s'arrête, et on répond comme si de rien n'était.
  if (!user || user.anonymizedAt) return { status: 'sent' }

  // On INSCRIT l'envoi, on ne l'attend pas.
  //
  // Ce qui disparaît ici, ce n'est pas seulement du temps de réponse : c'est
  // aussi un défaut de fiabilité. Auparavant, un prestataire d'e-mail
  // indisponible trente secondes se soldait par « consultez votre boîte », un
  // e-mail jamais parti, et une trace dans Sentry que personne ne lisait le
  // soir même. La personne restait enfermée dehors sans qu'aucun mécanisme ne
  // rattrape l'échec. La file, elle, reprend selon l'échelle annoncée — une
  // minute, cinq, trente, deux heures, six heures — et signale l'abandon.
  //
  // Ni l'adresse ni le jeton ne voyagent dans la charge utile : le jeton est
  // créé par le travail, et l'adresse relue à l'exécution.
  const jobId = await enqueue(prisma, {
    type: 'auth.password-reset',
    payload: { userId: user.id, locale: parsed.data.locale },
  })

  logResetRequested(user.id)

  runAfterResponse(jobId)

  return { status: 'sent' }
}

/**
 * Pousse le travail juste inscrit, une fois la réponse partie.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il ne suffit pas de laisser faire le cron
 * ---------------------------------------------------------------------------
 * Il passe toutes les cinq minutes. Pour une confirmation de commande, c'est
 * sans importance. Pour un lien de réinitialisation, c'est une éternité : la
 * personne attend devant son écran, ne voit rien arriver, et reclique. Or le
 * compteur par adresse est à trois par heure — au troisième clic elle serait
 * plafonnée en silence et n'aurait plus aucun e-mail. Fermer une fuite en
 * enfermant les gens dehors n'est pas fermer une fuite.
 *
 * ---------------------------------------------------------------------------
 * APRÈS la réponse, et c'est tout l'intérêt
 * ---------------------------------------------------------------------------
 * `after` exécute son rappel une fois la réponse écoulée, et la plateforme
 * garde la fonction en vie pour cela. Ce qui s'y passe n'entre donc pas dans le
 * temps observé par qui chronomètre — c'est ce qui permet de rendre l'e-mail
 * immédiat sans rouvrir l'écart qu'on vient de fermer.
 *
 * C'est aussi pour cela qu'on n'a PAS simplement lancé la promesse sans
 * l'attendre : sur une fonction serverless, le processus est gelé dès la
 * réponse renvoyée, et l'e-mail ne serait jamais parti — sans que personne ne
 * le sache. C'est le troisième piège décrit en tête de `lib/jobs/queue.ts`.
 */
function runAfterResponse(jobId: string): void {
  try {
    after(async () => {
      // `runJobNow` ne lève pas : voir son en-tête. Une promesse rejetée ici
      // n'aurait personne pour la recevoir.
      await runJobNow(jobId)
    })
  } catch {
    // `after` exige un contexte de requête. Hors de là — un test, un script de
    // maintenance — il lève, et c'est sans conséquence : le travail est inscrit,
    // le cron le prendra. On n'accélère pas, on ne perd rien.
  }
}

/**
 * Pose du nouveau mot de passe.
 *
 * ---------------------------------------------------------------------------
 * Le jeton est consommé ICI, à l'envoi du formulaire — jamais à l'ouverture
 * ---------------------------------------------------------------------------
 * Les filtres antivirus des messageries d'entreprise suivent les liens des
 * messages entrants pour les inspecter. Un jeton consommé au rendu de la page
 * serait brûlé avant que la personne n'ait cliqué : elle recevrait « ce lien
 * n'est plus valide » sur un lien qu'elle n'a jamais ouvert.
 */
export async function resetPasswordAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  if (!isAuthConfigured()) {
    return { status: 'error', messageKey: 'notConfigured' }
  }

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.path[0] === 'password') {
      return { status: 'error', messageKey: 'passwordTooShort' }
    }
    return { status: 'error', messageKey: 'invalidLink' }
  }

  // Compteur sur le porteur du lien, pas sur le jeton : le jeton est unique et
  // à usage unique, il n'y a rien à marteler dessus. Ce qui se martèle, c'est
  // la DEVINETTE — envoyer des jetons au hasard pour tomber sur un valide. La
  // borne rend l'exercice sans objet, en plus des 256 bits d'entropie.
  const allowed = await checkRateLimit({
    key: `password-reset-submit:${await clientFingerprint()}`,
    limit: 10,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const outcome = await consumePasswordReset(parsed.data.token, parsed.data.password)

  if (!outcome.ok) {
    // Les quatre refus se disent d'une seule façon : « ce lien n'est plus
    // valide, demandez-en un autre ». Distinguer « inconnu » de « expiré »
    // apprendrait à qui tâtonne si son jeton a un jour existé.
    return { status: 'error', messageKey: 'invalidLink' }
  }

  // Toutes les sessions ont été détruites par la consommation, y compris celle
  // de la personne si elle était connectée. On lui en ouvre une nouvelle : elle
  // vient de prouver qu'elle tient la boîte et de choisir un mot de passe,
  // c'est le moment où elle est le plus authentifiée de toute sa visite.
  await createDatabaseSession(outcome.userId)

  // ---------------------------------------------------------------------------
  // La QUATRIÈME porte d'entrée, et elle avait été oubliée
  // ---------------------------------------------------------------------------
  // L'inscription, la connexion et le lien magique appellent tous
  // `adoptGuestSession`. La réinitialisation, non — et c'est une bascule
  // d'identité comme les trois autres.
  //
  // Le défaut, concret : une visiteuse négocie une pièce sans compte, l'offre
  // est acceptée, un e-mail lui promet ce prix pendant vingt-quatre heures.
  // Elle veut payer, ne retrouve pas son mot de passe, passe par « mot de passe
  // oublié ». À l'instant où elle se retrouve connectée, `readNegotiatedPrices`
  // cherche les offres du COMPTE et n'en trouve aucune : son offre acceptée est
  // restée sur le jeton d'invitée. Elle paie le prix affiché, pas le prix promis
  // par écrit — sans qu'aucun message ne signale l'écart. Son panier et ses
  // favoris d'avant sont invisibles de la même façon.
  //
  // `adoptGuestSession` renouvelle AUSSI le jeton de session boutique. Sans lui,
  // sur un poste partagé, la personne qui réinitialise héritait du panier et des
  // favoris laissés par la précédente.
  await adoptGuestSession(outcome.userId, outcome.email)

  return { status: 'done' }
}
