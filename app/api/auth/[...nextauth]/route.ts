import { NextResponse, type NextRequest } from 'next/server'

import { handlers } from '@/lib/auth'
import { checkRateLimit } from '@/lib/security/rate-limit'
import { clientFingerprint } from '@/lib/security/fingerprint'
import { pseudonymize } from '@/lib/security/pseudonymize'
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

  // L'adresse voyage dans le corps du formulaire. On lit une COPIE : consommer
  // le corps ici priverait Auth.js du sien.
  let email: string | null = null
  try {
    const body = await request.clone().formData()
    const value = body.get('email')
    if (typeof value === 'string') email = value.trim().toLowerCase()
  } catch {
    // Corps illisible : rien à compter par adresse, le compteur par origine
    // ci-dessus a déjà fait son office.
    return true
  }

  if (!email) return true

  return checkRateLimit({
    key: `magic-mail:${pseudonymize({
      purpose: 'rate-limit:magic-email',
      value: email,
      rotateDaily: true,
    })}`,
    limit: 3,
    windowSeconds: 3600,
    sensitive: true,
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
): Promise<Response> {
  const { nextauth } = await context.params

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
  if (nextauth[0] === 'callback' && nextauth[1] === 'magic-link') {
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
