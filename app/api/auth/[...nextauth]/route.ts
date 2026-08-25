import { NextResponse, type NextRequest } from 'next/server'

import { handlers } from '@/lib/auth'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
import { mailboxIdentity } from '@/lib/security/mail-identity'
import {
  clearConfirmation,
  hasConfirmation,
  tokenFromCallback,
} from '@/lib/auth/magic-link-guard'

/**
 * Les routes d'Auth.js, encadrées.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ce fichier ne réexporte plus les gestionnaires tels quels
 * ---------------------------------------------------------------------------
 * Il le faisait, et cela ouvrait deux portes que le reste du projet croyait
 * fermées. Les deux ont le même motif : les protections avaient été posées sur
 * la Server Action du FORMULAIRE (`magicLinkAction`), alors qu'Auth.js expose
 * ses propres adresses HTTP à côté — que personne n'est obligé d'emprunter par
 * le formulaire.
 *
 * 1. AUCUNE LIMITATION DE DÉBIT. `magicLinkAction` porte deux compteurs, dont
 *    un par adresse, avec un commentaire qui décrit précisément le risque :
 *    noyer la boîte d'une personne ciblée sous des messages légitimement
 *    signés par notre domaine, jusqu'à la mise en quarantaine de l'adresse
 *    d'envoi — et alors plus aucun e-mail transactionnel délivré à personne,
 *    confirmations de commande comprises. `POST /api/auth/signin/magic-link`
 *    n'en avait aucun. Mesuré : huit requêtes consécutives, huit envois.
 *
 * 2. LE RAPPEL EN GET N'EXIGEAIT AUCUNE CONFIRMATION. Voir
 *    `lib/auth/magic-link-guard.ts` pour le détail : c'est la CSRF de
 *    connexion, dont l'échéance était fixée à la mise en service du tunnel de
 *    commande.
 *
 * Les deux contrôles vivent ici plutôt que dans un middleware : le middleware
 * tourne sur le moteur périphérique, sans accès aux compteurs ni au secret de
 * signature.
 *
 * ---------------------------------------------------------------------------
 * Ce que le premier correctif avait manqué, et qu'un audit a trouvé
 * ---------------------------------------------------------------------------
 * Les deux gardes ci-dessus étaient posées sur le VERBE, pas sur la route :
 *
 * 1. LA GARDE DE CONFIRMATION NE VIVAIT QUE DANS `GET`. Or `@auth/core`
 *    traite `callback` en POST aussi, et n'y exige `validateCSRF` que pour les
 *    fournisseurs de type `credentials` (`lib/index.js`, branche `else`). Le
 *    lien magique est de type `email` : un POST vers
 *    `/api/auth/callback/magic-link?token=…&email=…` — le jeton est lu dans la
 *    CHAÎNE DE REQUÊTE (`lib/actions/callback/index.js`) — atteignait donc
 *    `actions.callback` sans preuve de confirmation ET sans jeton anti-CSRF.
 *
 *    C'est la CSRF de connexion en entier, par la porte d'à côté : un
 *    formulaire auto-soumis depuis un site tiers connecte la victime au compte
 *    de l'attaquant, et tout ce qu'elle fait ensuite — adresse, commande,
 *    négociation — atterrit dans un compte qu'il lit.
 *
 * 2. LE COMPTEUR PAR ADRESSE SE CONTOURNAIT AVEC UN CORPS JSON. `throttleSignIn`
 *    lisait le corps avec `formData()`, qui LÈVE sur `application/json` — et le
 *    `catch` laissait passer. Or `@auth/core` accepte le JSON
 *    (`lib/utils/web.js`). Un envoi par minute devenait donc un envoi sans
 *    limite, vers l'adresse de son choix.
 *
 * La leçon, écrite ici pour la prochaine fois : une garde posée dans `GET` ou
 * dans `POST` protège un VERBE. Ce qu'on veut protéger est une ROUTE.
 */

// Prisma et argon2 ne s'exécutent pas sur l'Edge.
export const runtime = 'nodejs'

/** Adresse de connexion, dans la langue par défaut du site. */
function signInUrl(request: NextRequest, error: string): URL {
  const url = new URL('/fr/connexion', request.nextUrl.origin)
  url.searchParams.set('erreur', error)
  return url
}

/**
 * Les deux mêmes compteurs que le formulaire, sur la route brute.
 *
 * Ils sont volontairement identiques à ceux de `magicLinkAction` : deux
 * plafonds différents pour le même envoi seraient une invitation à emprunter
 * le plus permissif.
 */
async function throttleSignIn(request: NextRequest): Promise<boolean> {
  const byOrigin = await checkRateLimit({
    key: `magic:${await clientFingerprint()}`,
    limit: 5,
    windowSeconds: 900,
    sensitive: true,
  })
  if (!byOrigin) return false

  const email = await emailFromBody(request)

  // ---------------------------------------------------------------------------
  // Adresse illisible : on REFUSE. C'était l'inverse, et c'était le trou.
  // ---------------------------------------------------------------------------
  // La version précédente lisait le corps avec `formData()` seul, qui LÈVE sur
  // un corps `application/json` — et le `catch` laissait passer. Or `@auth/core`
  // accepte le JSON : il suffisait de changer l'en-tête `Content-Type` pour que
  // le compteur par adresse ne s'applique jamais.
  //
  // On lit donc les deux encodages ci-dessous, et ce qui reste illisible est
  // refusé plutôt qu'accordé. Le refus ne coûte rien de légitime : sans adresse
  // exploitable, Auth.js n'a de toute façon aucun message à envoyer.
  if (!email) return false

  return checkRateLimit({
    key: `magic-mail:${pseudonymize({
      purpose: 'rate-limit:magic-email',
      value: mailboxIdentity(email),
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
}

/**
 * L'adresse portée par le corps, quel que soit son encodage.
 *
 * On lit une COPIE : consommer le corps ici priverait Auth.js du sien.
 *
 * Les deux encodages sont tentés parce qu'`@auth/core` les accepte tous les
 * deux. N'en lire qu'un revient à offrir l'autre comme contournement — c'est
 * exactement ce qui s'est produit.
 */
async function emailFromBody(request: NextRequest): Promise<string | null> {
  const read = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== ''
      ? value.trim().toLowerCase()
      : null

  try {
    const form = await request.clone().formData()
    const found = read(form.get('email'))
    if (found) return found
  } catch {
    // Pas un corps de formulaire : on tente le JSON ci-dessous.
  }

  try {
    const body = (await request.clone().json()) as { email?: unknown }
    return read(body?.email)
  } catch {
    return null
  }
}

/** La route demandée est-elle le rappel du lien magique ? */
function isMagicCallback(nextauth: string[]): boolean {
  return nextauth[0] === 'callback' && nextauth[1] === 'magic-link'
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
): Promise<Response> {
  const { nextauth } = await context.params

  // ---------------------------------------------------------------------------
  // Le rappel du lien magique n'existe QU'EN GET
  // ---------------------------------------------------------------------------
  // Le parcours légitime est un clic sur un lien, puis un bouton sur la page de
  // confirmation — deux GET. Aucun POST n'a de raison d'arriver ici, et celui
  // qui arriverait contournerait la garde de confirmation, `@auth/core`
  // n'exigeant de jeton anti-CSRF que pour les fournisseurs `credentials`.
  //
  // On refuse donc le VERBE plutôt que de recopier la garde : une garde
  // recopiée finit par diverger, un verbe refusé ne peut pas.
  if (isMagicCallback(nextauth)) {
    return NextResponse.redirect(signInUrl(request, 'lien-non-confirme'), {
      status: 303,
    })
  }

  if (nextauth[0] === 'signin') {
    const allowed = await throttleSignIn(request)
    // Réponse identique à celle d'un envoi réussi : dire « trop de tentatives »
    // ici rétablirait l'oracle que le formulaire ferme — on saurait qu'une
    // adresse vient d'être sollicitée.
    if (!allowed) {
      return NextResponse.redirect(
        new URL('/fr/connexion?lien=envoye', request.nextUrl.origin),
        { status: 303 },
      )
    }
  }

  return handlers.POST(request)
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
): Promise<Response> {
  const { nextauth } = await context.params

  // Rappel du lien magique : il faut la preuve posée par la page de
  // confirmation. Un GET amené devant une victime ne l'a pas.
  if (isMagicCallback(nextauth)) {
    const token = tokenFromCallback(request.nextUrl)

    if (!token || !(await hasConfirmation(token))) {
      return NextResponse.redirect(signInUrl(request, 'lien-non-confirme'), {
        status: 303,
      })
    }

    // La preuve a servi. Le jeton de connexion est à usage unique ; la sienne
    // doit l'être aussi, sinon elle resterait valable cinq minutes.
    await clearConfirmation()
  }

  return handlers.GET(request)
}
