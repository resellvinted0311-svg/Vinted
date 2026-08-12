import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')

const isDev = process.env.NODE_ENV === 'development'

/**
 * CSP volontairement sans nonce en Phase 0.
 *
 * Un nonce impose le rendu dynamique de chaque page, ce qui est incompatible
 * avec les cibles Core Web Vitals du brief (LCP < 2,5 s sur le catalogue, qui
 * doit rester statiquement optimisable). La politique ci-dessous reste stricte
 * sur `script-src` ; `style-src` tolère l'inline parce que Next injecte les
 * styles critiques ainsi. À réévaluer en Phase 8 (durcissement).
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
      { protocol: 'https', hostname: 'res.cloudinary.com' },
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
