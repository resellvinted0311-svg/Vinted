import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing, locales } from '@/lib/i18n/routing'
import { stripLocalePrefix } from '@/lib/security/safe-path'
import { buildCsp, STRICT_CSP_PATH } from '@/lib/security/csp'

const intlMiddleware = createIntlMiddleware(routing)

const isDev = process.env.NODE_ENV === 'development'

/**
 * Nom du cookie de session, dupliqué ici volontairement.
 *
 * Le middleware s'exécute sur l'Edge : importer lib/auth/cookies.ts tirerait
 * la chaîne jusqu'à Prisma et argon2, qui ne s'y exécutent pas.
 */
const SESSION_COOKIE = [
  '__Host-authjs.session-token',
  // L'ancien nom, le temps que les sessions déjà ouvertes s'éteignent. Sans
  // lui, un changement de préfixe déconnecterait tout le monde d'un coup.
  // À retirer une fois la durée de session (30 jours) écoulée après le
  // déploiement — ce n'est pas une faille tant qu'il reste, seulement un nom
  // de plus que le middleware accepte : le contrôle qui fait autorité relit la
  // session en base, page par page.
  '__Secure-authjs.session-token',
  'authjs.session-token',
]

const localePattern = locales.join('|')
const ADMIN_PATH = new RegExp(`^/(${localePattern})/admin(/|$)`)

/**
 * Espaces qui exigent une session.
 *
 * `checkout` n'y figure PAS : le paiement sans compte est un choix assumé.
 * Rediriger vers la connexion au moment de payer, c'est perdre la vente. Le
 * tunnel demande une adresse e-mail de contact, pas un mot de passe.
 */
const PRIVATE_PATH = new RegExp(`^/(${localePattern})/compte(/|$)`)

export default function middleware(request: NextRequest): NextResponse {
  const response = intlMiddleware(request)

  const { pathname } = request.nextUrl

  // ---------------------------------------------------------------------------
  // Politique de sécurité de contenu STRICTE sur les pages rendues à la requête
  // ---------------------------------------------------------------------------
  // `next.config.ts` pose une politique permissive sur toutes les réponses.
  // Elle est remplacée ici, pour les seules pages capables de porter un nonce,
  // par une politique qui n'autorise plus aucun script en ligne non signé.
  //
  // Ce sont exactement les pages qui manipulent de l'argent, une session et des
  // données personnelles. Le catalogue, prérendu, ne peut pas en bénéficier :
  // son HTML est figé au build alors que le nonce change à chaque requête. Le
  // raisonnement complet et les mesures qui le fondent sont dans
  // `lib/security/csp.ts`.
  //
  // Le nonce est tiré par `crypto.randomUUID()` — présent sur l'Edge, et
  // imprévisible, ce qui est la seule propriété qui compte ici : un nonce
  // devinable ne vaut pas mieux qu'`unsafe-inline`.
  if (!isDev && STRICT_CSP_PATH.test(pathname)) {
    const nonce = btoa(crypto.randomUUID())
    response.headers.set(
      'Content-Security-Policy',
      buildCsp({ nonce, isDev: false }),
    )
  }

  const needsAuth = ADMIN_PATH.test(pathname) || PRIVATE_PATH.test(pathname)

  if (needsAuth) {
    const hasSessionCookie = SESSION_COOKIE.some((name) =>
      request.cookies.has(name),
    )

    // Contrôle volontairement grossier : l'Edge ne peut pas interroger la
    // base, donc on se contente de constater la présence du cookie. Le
    // contrôle qui fait autorité — session valide et rôle ADMIN — est fait
    // dans chaque page et chaque action serveur via requireAdmin().
    if (!hasSessionCookie) {
      const locale = pathname.split('/')[1] ?? routing.defaultLocale
      const target = new URL(`/${locale}/connexion`, request.url)

      // SANS le préfixe de langue : le routeur de next-intl le remet au
      // moment de rediriger. Le stocker entier donnait `/fr/fr/compte`, donc
      // une 404 — la reprise vers la page demandée ne fonctionnait jamais.
      target.searchParams.set('suite', stripLocalePrefix(pathname, locales))
      return NextResponse.redirect(target)
    }
  }

  // Le panier, le tunnel, les commandes et le compte ne doivent jamais être
  // indexés. `commande` couvre la page de retour de paiement, l'historique et
  // les factures : l'URL de retour porte l'identifiant de session Stripe, et
  // une page de commande affiche une adresse postale.
  if (needsAuth || /\/(panier|checkout|commande)(\/|$)/.test(pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  return response
}

/**
 * Où le middleware s'exécute.
 *
 * L'exclusion précédente était `.*\..*` : « tout chemin contenant un point ».
 * Elle visait les fichiers statiques, mais elle disait bien plus que cela.
 * `/fr/admin/articles/nike.air` contient un point : le middleware ne s'y
 * exécutait pas du tout. La redirection vers la connexion sautait, et
 * l'en-tête `noindex` aussi. Il suffisait d'un point dans un segment
 * dynamique — un slug, un identifiant, un nom de fichier — pour sortir du
 * champ de la surveillance.
 *
 * On énumère donc les extensions réellement statiques, ancrées en fin de
 * chemin. Un point AU MILIEU d'une URL ne fait plus rien de particulier.
 *
 * Cela ne remplace rien : le contrôle qui fait autorité reste `requireAdmin()`
 * dans chaque page et chaque action serveur. Un middleware est une commodité
 * de routage, jamais une frontière de sécurité — il ne voit pas la base, donc
 * il ne sait pas qui vous êtes.
 */
export const config = {
  matcher: [
    '/((?!api|_next|_vercel|placeholder|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|txt|xml|json|webmanifest|woff2?|ttf|otf|eot|pdf|mp4|webm)$).*)',
  ],
}
