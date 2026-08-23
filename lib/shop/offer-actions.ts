'use server'

import { revalidatePath } from 'next/cache'

import { parseAmountToCents } from '@/lib/domain/money'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { submitOfferSchema } from '@/lib/validation/offers'
import { ensureCartOwner } from '@/lib/shop/cart'
import { submitOffer } from '@/lib/shop/offers'

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
  revalidatePath('/', 'layout')

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
