import 'server-only'

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { prisma } from '@/lib/db/client'
import { SITE } from '@/lib/config/site'
import { logger } from '@/lib/observability/logger'
import { hashPassword } from './password'

/**
 * Réinitialisation de mot de passe — la partie qui touche la base.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce module vient combler
 * ---------------------------------------------------------------------------
 * `UserToken` existait depuis la première migration. Elle est purgée à
 * échéance par `lib/privacy/retention.ts`, effacée avec le compte par
 * `lib/privacy/anonymize.ts`… et n'était **écrite par rien**. Le dossier RGPD
 * la listait comme « déclarée, non branchée ».
 *
 * Conséquence pour une cliente : aucune page « mot de passe oublié ». Le lien
 * magique servait de porte de secours, mais rien ne le disait — et une
 * personne qui a choisi un mot de passe cherche un chemin qui porte ce nom.
 *
 * ---------------------------------------------------------------------------
 * Le jeton est HACHÉ en base, comme un mot de passe
 * ---------------------------------------------------------------------------
 * `UserToken` est une liste de clés d'accès à des comptes. Une lecture seule de
 * la base — une sauvegarde égarée, un réplica mal configuré, un export de
 * débogage — suffirait à ouvrir toutes les réinitialisations en cours si les
 * jetons y étaient en clair.
 *
 * Un hachage RAPIDE suffit ici, contrairement aux mots de passe : le jeton fait
 * trente-deux octets tirés au hasard. Il n'y a rien à deviner, donc rien à
 * ralentir — argon2id ne protégerait contre aucune attaque réelle et coûterait
 * une seconde de calcul à chaque clic.
 *
 * ---------------------------------------------------------------------------
 * Ouvrir le lien ne CONSOMME pas le jeton
 * ---------------------------------------------------------------------------
 * Le défaut classique, et il frappe des gens parfaitement légitimes : les
 * filtres antivirus des messageries d'entreprise **suivent les liens** des
 * messages entrants pour les inspecter. Un jeton consommé à l'ouverture serait
 * donc brûlé avant que la personne n'ait cliqué, et elle recevrait « ce lien
 * n'est plus valide » sur un lien qu'elle n'a jamais ouvert.
 *
 * L'ouverture ne fait donc que VÉRIFIER. La consommation a lieu à l'envoi du
 * formulaire, par une action serveur. C'est le même raisonnement que celui qui
 * a fait naître la page de confirmation du lien magique.
 */

/** Discriminant de `UserToken.type`. La table est prévue pour en porter d'autres. */
const TOKEN_TYPE = 'password-reset'

/**
 * Durée de vie d'un lien : trente minutes.
 *
 * Un lien de réinitialisation est une clé du compte. Il vit dans une boîte de
 * réception — parfois consultée sur un poste partagé, parfois compromise plus
 * tard. Vingt-quatre heures d'ouverture pour un geste qui se fait en deux
 * minutes n'achètent aucun confort et vendent beaucoup de surface.
 */
export const RESET_TTL_MINUTES = 30

/** Trente-deux octets tirés au hasard, en base64url : rien à deviner. */
function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * L'empreinte stockée.
 *
 * SHA-256 sans sel : le sel protège contre les tables précalculées, qui n'ont
 * aucun sens face à une valeur aléatoire de trente-deux octets. En ajouter un
 * donnerait l'illusion d'une précaution sans rien changer.
 */
function fingerprintOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface ResetRequest {
  /** Le jeton EN CLAIR, à mettre dans le lien. Jamais conservé nulle part. */
  token: string
  expiresAt: Date
  url: string
}

/**
 * Ouvre une réinitialisation pour un compte, et renvoie le lien à envoyer.
 *
 * ---------------------------------------------------------------------------
 * Les jetons précédents sont INVALIDÉS
 * ---------------------------------------------------------------------------
 * Sans cela, chaque demande ajouterait une clé vivante au trousseau. Une
 * personne qui clique trois fois sur « mot de passe oublié » parce que le
 * premier message tarde laisserait trois liens ouverts pendant une demi-heure,
 * dans trois messages qu'elle ne relira pas. On n'en garde qu'un : le dernier
 * demandé.
 */
export async function openPasswordReset(
  userId: string,
  locale: string,
  now = new Date(),
): Promise<ResetRequest> {
  const token = newToken()
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000)

  await prisma.$transaction(async (tx) => {
    // Marqués utilisés plutôt que supprimés : la ligne reste, sans rien
    // ouvrir, et la purge à échéance s'en charge. Supprimer ici ferait perdre
    // la trace qu'une demande a eu lieu.
    await tx.userToken.updateMany({
      where: { userId, type: TOKEN_TYPE, usedAt: null },
      data: { usedAt: now },
    })

    await tx.userToken.create({
      data: {
        userId,
        type: TOKEN_TYPE,
        tokenHash: fingerprintOf(token),
        expiresAt,
      },
    })
  })

  return {
    token,
    expiresAt,
    url: `${SITE.url}/${locale}/connexion/mot-de-passe/${token}`,
  }
}

export type ResetLookup =
  | { ok: true; userId: string; tokenId: string }
  | { ok: false; reason: 'unknown' | 'used' | 'expired' }

/**
 * Le jeton est-il utilisable ? N'écrit RIEN.
 *
 * Appelé au rendu de la page, où consommer serait un défaut (voir l'en-tête).
 * Appelé aussi au début de la consommation, qui refait la vérification dans sa
 * transaction — la fenêtre entre les deux appartient à qui la lit.
 */
export async function lookupPasswordReset(
  token: string,
  now = new Date(),
): Promise<ResetLookup> {
  const row = await prisma.userToken.findUnique({
    where: { tokenHash: fingerprintOf(token) },
    select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true },
  })

  if (!row || row.type !== TOKEN_TYPE) return { ok: false, reason: 'unknown' }
  if (row.usedAt) return { ok: false, reason: 'used' }
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' }

  return { ok: true, userId: row.userId, tokenId: row.id }
}

export type ResetOutcome =
  | {
      ok: true
      userId: string
      /**
       * L'adresse du compte, pour la reprise de session.
       *
       * Elle est déjà lue dans la transaction : la remonter ne coûte rien, et
       * sans elle `resetPasswordAction` ne peut pas appeler `adoptGuestSession`,
       * qui exige les DEUX concordances — le jeton du navigateur et l'adresse.
       */
      email: string
    }
  | { ok: false; reason: 'unknown' | 'used' | 'expired' | 'no-account' }

/**
 * Consomme le jeton et pose le nouveau mot de passe.
 *
 * ---------------------------------------------------------------------------
 * La consommation est un UPDATE CONDITIONNEL
 * ---------------------------------------------------------------------------
 * `WHERE "usedAt" IS NULL`. Deux envois du formulaire — un double clic, un
 * onglet resté ouvert — ne posent qu'un mot de passe. Sans le prédicat, le
 * second écraserait le premier : la personne aurait choisi un mot de passe et
 * s'en verrait attribuer un autre, sans rien qui l'explique.
 *
 * ---------------------------------------------------------------------------
 * TOUTES les autres sessions tombent
 * ---------------------------------------------------------------------------
 * C'est le point le plus important de ce module, et celui qu'on oublie le plus
 * souvent. On réinitialise un mot de passe parce qu'on l'a oublié — ou parce
 * qu'on soupçonne quelqu'un d'autre de l'avoir. Dans le second cas, laisser
 * vivre les sessions ouvertes rend le geste inutile : l'intrus reste connecté,
 * et il l'est même APRÈS que la personne a « repris la main ».
 */
export async function consumePasswordReset(
  token: string,
  password: string,
  now = new Date(),
): Promise<ResetOutcome> {
  const found = await lookupPasswordReset(token, now)
  if (!found.ok) return found

  // Haché HORS transaction : argon2id prend des centaines de millisecondes, et
  // la production n'accorde qu'une connexion par instance — la tenir pendant
  // ce calcul affamerait tout ce qui tourne à côté.
  const passwordHash = await hashPassword(password)

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.userToken.updateMany({
      where: { id: found.tokenId, usedAt: null },
      data: { usedAt: now },
    })

    // Zéro ligne : quelqu'un d'autre a consommé ce jeton entre la lecture et
    // l'écriture.
    if (claimed.count === 0) return { ok: false as const, reason: 'used' as const }

    // Le compte a pu être effacé entre l'envoi du lien et son usage. Poser un
    // mot de passe sur une ligne anonymisée la ferait revivre — c'est
    // exactement le défaut qu'un jeton de vérification survivant avait déjà
    // produit une fois, et qui recréait un compte supprimé.
    const user = await tx.user.findFirst({
      where: { id: found.userId, anonymizedAt: null },
      select: { id: true, email: true },
    })
    if (!user) return { ok: false as const, reason: 'no-account' as const }

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    // Voir l'en-tête : sans cela, une reprise de compte laisse l'intrus
    // connecté.
    await tx.session.deleteMany({ where: { userId: user.id } })

    return { ok: true as const, userId: user.id, email: user.email }
  })
}

/**
 * Compare deux jetons à temps constant.
 *
 * Non utilisé par le chemin principal — la recherche se fait sur l'empreinte,
 * indexée et unique, donc sans comparaison en mémoire. Exporté pour les tests,
 * qui vérifient que l'empreinte d'un jeton falsifié ne correspond à rien.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(fingerprintOf(a), 'hex')
  const right = Buffer.from(fingerprintOf(b), 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Journalise une demande sans jamais journaliser le jeton ni l'adresse. */
export function logResetRequested(userId: string): void {
  logger.info('password_reset.requested', { userId })
}
