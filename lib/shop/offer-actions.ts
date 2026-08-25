'use server'

import { parseAmountToCents } from '@/lib/domain/money'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
import { mailboxIdentity } from '@/lib/security/mail-identity'
import { submitOfferSchema, answerCounterSchema } from '@/lib/validation/offers'
import { ensureCartOwner } from '@/lib/shop/cart'
import { submitOffer, answerCounterOffer } from '@/lib/shop/offers'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * Dépôt d'une offre — la seule écriture de négociation ouverte au navigateur.
 *
 * ---------------------------------------------------------------------------
 * AVERTISSEMENT — chaque export de ce fichier est une adresse HTTP publique
 * ---------------------------------------------------------------------------
 * `'use server'` ne rend pas un fichier privé : il rend PUBLIC tout ce qu'il
 * exporte. `lib/shop/offers.ts` exporte aussi `respondToOffer`, qui ACCEPTE une
 * offre au nom du vendeur, et `voidOffersForArticles`, qui éteint les
 * négociations d'une pièce. Exposer ce fichier tel quel donnerait à n'importe
 * qui le droit de s'accorder le prix de son choix.
 *
 * Ce module ne relaie donc que le dépôt, et il dérive l'identité de la
 * session — jamais d'un paramètre. La réponse du vendeur passera par le
 * back-office, derrière `requireAdmin()`.
 *
 * ---------------------------------------------------------------------------
 * Ce que l'appelant NE fournit PAS
 * ---------------------------------------------------------------------------
 * Aucun prix de référence, aucun plancher, aucun minimum. Ils sont relus en
 * base au moment de juger. Un montant de référence qui traverse le navigateur
 * est un montant qu'on peut réécrire — et la seule chose qu'il permettrait
 * serait de déclencher une acceptation automatique en annonçant un prix affiché
 * plus bas qu'il ne l'est.
 */

export type OfferActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string; retryAt?: string }
  | {
      status: 'done'
      /** `pending`, `auto-rejected` ou `auto-accepted`. */
      outcome: 'pending' | 'auto-rejected' | 'auto-accepted'
      amountCents: number
      expiresAt: string
      priceValidUntil: string | null
    }

/**
 * Traduit un refus en clé de message, sans rien révéler d'interne.
 *
 * Le prix plancher et le minimum de la pièce ne sortent jamais, même en creux :
 * dire « proposez au moins 21,00 € » livrerait le seuil de refus automatique,
 * qu'il suffirait alors d'effleurer à chaque fois.
 */
function messageKeyFor(rejection: string): string {
  switch (rejection) {
    case 'offers-disabled':
      return 'offersDisabled'
    case 'offers-not-open-yet':
      return 'offersNotOpenYet'
    case 'article-unavailable':
    case 'article-unknown':
      return 'articleUnavailable'
    case 'below-absolute-minimum':
      return 'belowAbsoluteMinimum'
    case 'not-below-asking-price':
      return 'notBelowAskingPrice'
    case 'already-pending':
      return 'alreadyPending'
    case 'too-many-attempts':
      return 'tooManyAttempts'
    case 'cooldown':
      return 'cooldown'
    default:
      return 'unknown'
  }
}

const ERROR = (messageKey: string, retryAt?: Date): OfferActionState => ({
  status: 'error',
  messageKey,
  ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
})

export async function submitOfferAction(
  _previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  // Chemin SENSIBLE : il écrit en base et déclenche un e-mail. Laisser passer
  // en cas de panne du compteur offrirait un robot d'envoi de courrier à qui
  // sait poster un formulaire.
  const allowed = await checkRateLimit({
    key: `offer:${await clientFingerprint()}`,
    limit: 10,
    windowSeconds: 60,
    sensitive: true,
  })
  if (!allowed) return ERROR('rateLimited')

  const raw = formData.get('amountEuros')
  const parsed = submitOfferSchema.safeParse({
    articleId: formData.get('articleId'),
    // Le formulaire parle en euros — c'est ce qu'une personne saisit — et la
    // conversion se fait ICI, une fois, plutôt que dans le composant. Un
    // arrondi côté navigateur enverrait un nombre à virgule flottante dans un
    // calcul de prix.
    amountCents: parseAmountToCents(typeof raw === 'string' ? raw : ''),
    email: readOptional(formData.get('email')),
  })

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return ERROR(field === 'email' ? 'emailRequired' : 'invalidAmount')
  }

  const owner = await ensureCartOwner()

  // Sans compte, l'adresse est la seule voie de réponse. Accepter une offre
  // qu'on ne pourrait pas répondre reviendrait à la perdre en silence.
  if (!owner.userId && !parsed.data.email) return ERROR('emailRequired')

  // -------------------------------------------------------------------------
  // Second compteur, par ADRESSE — sans lui, ce formulaire est un robot
  // d'envoi de courrier vers la boîte de n'importe qui
  // -------------------------------------------------------------------------
  //
  // Le compteur par empreinte ci-dessus ne suffit pas, et pour une raison qui
  // n'est pas théorique : sans cookie, `ensureCartOwner` FRAPPE UN JETON NEUF
  // à chaque requête. Les garde-fous de `evaluateOffer` — une seule offre en
  // attente, plafond de tentatives, carence après refus — s'appuient tous sur
  // l'identité du propriétaire. Une requête sans cookie repart donc à zéro sur
  // les trois, indéfiniment.
  //
  // Il reste alors, entre l'attaquant et la boîte de sa cible, la seule limite
  // par IP — que loue un pool de proxys. Chaque offre déposée déclenche un
  // accusé de réception LÉGITIMEMENT signé par notre domaine d'envoi. Le coût
  // ne serait pas pour la personne visée seule : plaintes pour spam chez le
  // prestataire, mise en quarantaine de l'adresse d'envoi, et plus aucun
  // e-mail transactionnel délivré à personne.
  //
  // C'est exactement le défaut déjà corrigé sur le lien magique
  // (`lib/auth/actions.ts`), sur un formulaire qui envoie le même type de
  // message à une adresse tout aussi arbitraire.
  //
  // Le plafond est plus large que les trois du lien magique : proposer un prix
  // sur plusieurs pièces au cours d'une même visite est un usage normal, alors
  // qu'on ne demande pas trois liens de connexion d'affilée. Cinq par heure
  // laisse passer la visite et arrête le déluge.
  //
  // Le compteur porte sur un jeton, jamais sur l'adresse en clair : la clé
  // part chez un tiers.
  //
  // Seulement pour les offres SANS COMPTE : avec un compte, l'accusé part vers
  // l'adresse du compte, que l'appelant ne choisit pas. Il n'y a personne
  // d'autre à inonder que soi-même.
  if (!owner.userId && parsed.data.email) {
    const byAddress = await checkRateLimit({
      key: `offer-mail:${pseudonymize({
        purpose: 'rate-limit:offer-email',
        value: mailboxIdentity(parsed.data.email),
        rotateDaily: true,
      })}`,
      limit: 5,
      windowSeconds: 3600,
      sensitive: true,
    })
    // Réponse franche, contrairement au lien magique qui doit rester muet pour
    // ne pas révéler si un compte existe. Ici il n'y a pas d'oracle à fermer :
    // le compteur ne dit rien de la personne visée, seulement que CETTE
    // adresse a servi cinq fois dans l'heure — ce que celui qui l'a saisie
    // sait déjà. Mentir à quelqu'un qui négocie de bonne foi coûterait plus.
    if (!byAddress) return ERROR('rateLimited')
  }

  const result = await submitOffer({
    articleId: parsed.data.articleId,
    amountCents: parsed.data.amountCents,
    owner: {
      userId: owner.userId,
      sessionToken: owner.sessionToken,
      email: parsed.data.email ?? null,
    },
  })

  if (!result.ok) {
    return ERROR(messageKeyFor(result.rejection), result.retryAt)
  }

  // La fiche article affiche l'état de la négociation : sans invalidation, la
  // personne reverrait le formulaire vide après avoir déposé son offre.
  // Aucune invalidation de cache ici, et c'est délibéré.
  //
  // `revalidatePath('/', 'layout')` purge TOUT ce que la mise en page racine
  // enveloppe — les 171 pages prérendues. Il ne rafraîchissait rien : les pages
  // qui portent l'état d'une négociation ou d'une commande sont toutes
  // `force-dynamic`, donc jamais mises en cache, et la fiche article ne lit
  // aucune donnée d'offre au rendu (le formulaire est un composant client).
  //
  // Purger un cache dont rien ne dépend est gratuit en apparence seulement :
  // sur un chemin ouvert au public, c'est un levier de déni de service, et le
  // catalogue cesse d'être servi depuis le cache. Voir
  // `tests/security/cache-invalidation.test.ts`.

  return {
    status: 'done',
    outcome: result.outcome,
    amountCents: parsed.data.amountCents,
    expiresAt: result.expiresAt.toISOString(),
    priceValidUntil: result.priceValidUntil?.toISOString() ?? null,
  }
}

function readOptional(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

// ---------------------------------------------------------------------------
// Réponse à une contre-proposition
// ---------------------------------------------------------------------------

export type CounterActionState =
  | { status: 'idle' }
  | { status: 'error'; messageKey: string }
  | { status: 'done'; accepted: boolean; priceValidUntil: string | null }

/**
 * L'acheteuse accepte ou décline la contre-proposition de la boutique.
 *
 * ---------------------------------------------------------------------------
 * L'identité vient de la SESSION, jamais du formulaire
 * ---------------------------------------------------------------------------
 * Le navigateur n'envoie qu'un identifiant de ligne et un verbe. Le compte est
 * relu ici, et la portée de l'écriture en découle. Sans cela, un identifiant
 * d'offre suffirait à rendre payable — donc à s'accorder — le prix négocié par
 * quelqu'un d'autre.
 *
 * Une contre-proposition n'existe que pour un compte : `respondToOffer` refuse
 * d'en émettre une sur une offre déposée sans compte, faute d'écran où y
 * répondre. Il n'y a donc pas de chemin « invitée » à traiter ici.
 */
export async function answerCounterAction(
  _previous: CounterActionState,
  formData: FormData,
): Promise<CounterActionState> {
  const user = await getCurrentUser()
  if (!user) return { status: 'error', messageKey: 'signInRequired' }

  const parsed = answerCounterSchema.safeParse({
    counterOfferId: formData.get('counterOfferId'),
    answer: formData.get('answer'),
  })
  if (!parsed.success) return { status: 'error', messageKey: 'invalidRequest' }

  // Compteur sur le COMPTE, qui est prouvé, plutôt que sur l'empreinte
  // d'appelant. Ce qu'il borne n'est pas un abus — la personne ne peut agir que
  // sur ses propres lignes — mais le script qui boucle : chaque appel ouvre une
  // transaction, et la production n'accorde qu'une connexion par instance.
  const allowed = await checkRateLimit({
    key: `offer-answer:${user.id}`,
    limit: 60,
    windowSeconds: 3600,
    sensitive: true,
  })
  if (!allowed) return { status: 'error', messageKey: 'rateLimited' }

  const result = await answerCounterOffer({
    counterOfferId: parsed.data.counterOfferId,
    userId: user.id,
    answer: parsed.data.answer,
  })

  if (!result.ok) {
    // « Introuvable » recouvre aussi « ne vous appartient pas » : distinguer
    // les deux apprendrait à qui tâtonne quels identifiants existent.
    return { status: 'error', messageKey: result.reason }
  }

  // Le registre et la fiche article portent tous deux l'état de la
  // négociation : sans invalidation, la ligne resterait affichée « en attente »
  // et le bouton cliquable sur une réponse déjà donnée.
  // Voir la note plus haut : aucune invalidation globale.

  return {
    status: 'done',
    accepted: result.accepted,
    priceValidUntil: result.priceValidUntil?.toISOString() ?? null,
  }
}
