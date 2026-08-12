import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing, locales } from '@/lib/i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

/**
 * Nom du cookie de session, dupliqué ici volontairement.
 *
 * Le middleware s'exécute sur l'Edge : importer lib/auth/cookies.ts tirerait
 * la chaîne jusqu'à Prisma et argon2, qui ne s'y exécutent pas.
 */
const SESSION_COOKIE = ['__Secure-authjs.session-token', 'authjs.session-token']

const localePattern = locales.join('|')
const ADMIN_PATH = new RegExp(`^/(${localePattern})/admin(/|$)`)
const PRIVATE_PATH = new RegExp(
  `^/(${localePattern})/(compte|checkout)(/|$)`,
)

export default function middleware(request: NextRequest): NextResponse {
  const response = intlMiddleware(request)

  const { pathname } = request.nextUrl
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
      target.searchParams.set('suite', pathname)
      return NextResponse.redirect(target)
    }
  }

  // Le panier et le compte ne doivent jamais être indexés.
  if (needsAuth || /\/(panier|checkout)(\/|$)/.test(pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  return response
}

export const config = {
  matcher: [
    // Tout sauf les fichiers statiques, les images Next et les routes d'API.
    '/((?!api|_next|_vercel|placeholder|.*\\..*).*)',
  ],
}
