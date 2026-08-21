import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')

const isDev = process.env.NODE_ENV === 'development'

/**
 * CSP sans nonce, et ce que cela veut dire exactement.
 *
 * ---------------------------------------------------------------------------
 * Ce que cette politique NE fait PAS
 * ---------------------------------------------------------------------------
 * `script-src` porte `'unsafe-inline'`. Elle n'arrête donc AUCUN script en
 * ligne, y compris injecté. Le commentaire qui figurait ici prétendait
 * l'inverse — « la politique reste stricte sur script-src » — ce qui est pire
 * qu'un aveu : cela donnait à chaque relecture une assurance imméritée, et
 * dispensait de regarder la ligne juste en dessous.
 *
 * Ce n'est le premier rempart contre rien. Le premier rempart est
 * l'échappement, et il est en place : voir `lib/utils/json-ld.ts`, qui a
 * corrigé la seule injection réellement trouvée. La CSP serait le SECOND
 * filet, et il manque.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle fait quand même
 * ---------------------------------------------------------------------------
 * `connect-src` est restrictive : un script injecté ne pourrait pas renvoyer
 * ce qu'il vole vers un serveur tiers. `object-src 'none'`,
 * `frame-ancestors 'none'` et `base-uri 'self'` ferment trois autres portes.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi pas de nonce aujourd'hui
 * ---------------------------------------------------------------------------
 * Un nonce impose le rendu dynamique de chaque page qui en porte un, ce qui
 * retirerait le catalogue et les fiches article du rendu statique — donc les
 * cibles Core Web Vitals du brief (LCP < 2,5 s), qui portent le référencement.
 *
 * C'est un ARBITRAGE, pas un oubli, et il se tranchera en phase 8 avec
 * `'strict-dynamic'` : mesurer d'abord ce que coûte le passage en dynamique
 * des pages concernées, puis décider. Ce qui n'était pas acceptable, c'était
 * de le masquer derrière un commentaire faux.
 *
 * `style-src` tolère l'inline parce que Next injecte les styles critiques
 * ainsi ; l'enjeu y est bien moindre.
 */
const csp = [
  "default-src 'self'",
  // `unsafe-eval` uniquement en dev : react-refresh en a besoin.
  isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://res.cloudinary.com",
  "font-src 'self' data:",
  // Aucun script tiers avant consentement : la liste reste minimale et explicite.
  isDev
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self' https://api.stripe.com https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  typescript: {
    // Jamais de build qui passe malgré une erreur de type.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        /**
         * Restreint au compte Cloudinary de la boutique.
         *
         * Sans chemin, la règle autorisait N'IMPORTE QUEL compte Cloudinary.
         * L'impact restait borné — Next refuse ce qui n'est pas une image,
         * bloque le SVG et sert le résultat en pièce jointe isolée, donc
         * aucune page d'hameçonnage n'était possible — mais chaque variante
         * taille × qualité consomme une transformation FACTURÉE sur notre
         * quota, sans plafond, pour un nombre illimité d'URL sources.
         *
         * Sans `CLOUDINARY_CLOUD_NAME`, le motif ne correspond à rien : aucune
         * image distante n'est optimisée. C'est le bon sens de l'échec — mieux
         * vaut ne rien servir que servir le quota de quelqu'un d'autre.
         */
        pathname: `/${process.env.CLOUDINARY_CLOUD_NAME ?? '_non-configure'}/image/upload/**`,
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
