import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'
import { buildCsp } from './lib/security/csp'

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')

const isDev = process.env.NODE_ENV === 'development'

/**
 * En-têtes de sécurité, et la CSP de BASE.
 *
 * ---------------------------------------------------------------------------
 * Celle-ci est la politique permissive — la stricte vit dans le middleware
 * ---------------------------------------------------------------------------
 * Elle s'applique à toutes les réponses, et le middleware la REMPLACE par une
 * politique à nonce sur les pages rendues à la requête. Le raisonnement
 * complet, avec les mesures qui le fondent, est dans `lib/security/csp.ts`.
 *
 * En deux lignes : un nonce ne peut pas atteindre une page prérendue, dont le
 * HTML est figé au build. Le catalogue garde donc `unsafe-inline`, et les
 * pages qui manipulent argent, session et données personnelles ne l'ont plus.
 *
 * Ce que cette politique-ci ne fait pas, il faut le dire sans détour : sur les
 * pages qu'elle couvre, elle n'arrête AUCUN script en ligne, y compris injecté.
 * Le premier rempart y reste l'échappement — voir `lib/utils/json-ld.ts`, qui a
 * corrigé la seule injection réellement trouvée. Un commentaire prétendait
 * autrefois l'inverse ici ; c'était pire qu'un aveu, cela donnait à chaque
 * relecture une assurance imméritée.
 *
 * Ce qu'elle fait quand même, partout : `connect-src` n'autorise que Stripe,
 * `object-src 'none'`, `frame-ancestors 'none'` et `base-uri 'self'` ferment
 * trois autres portes.
 */
const csp = buildCsp({ isDev })

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // `interest-cohort` visait FLoC, retiré de Chrome : la directive est morte.
    // On la garde — elle ne coûte rien sur un navigateur ancien — et on ajoute
    // son successeur vivant, `browsing-topics`, qui lui est bien lu.
    value:
      'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()',
  },
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
