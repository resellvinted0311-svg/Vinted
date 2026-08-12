import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Fraunces, Inter_Tight } from 'next/font/google'

import { routing, locales, localeTags, type Locale } from '@/lib/i18n/routing'
import { SITE } from '@/lib/config/site'
import { ToastProvider } from '@/components/ui/toast'
import { FavoritesProvider } from '@/components/shop/favorites-provider'
import { SiteHeader } from '@/components/shop/site-header'
import { SiteFooter } from '@/components/shop/site-footer'

import '../globals.css'

const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['400', '500', '600'],
})

const interTight = Inter_Tight({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter-tight',
  display: 'swap',
})

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'site' })

  // hreflang complet + x-default : chaque page existe dans les 8 langues.
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}`]),
  )
  languages['x-default'] = `/${routing.defaultLocale}`

  return {
    metadataBase: new URL(SITE.url),
    title: {
      default: `${SITE.name} — ${t('tagline')}`,
      template: `%s — ${SITE.name}`,
    },
    description: t('tagline'),
    alternates: {
      canonical: `/${locale}`,
      languages,
    },
    openGraph: {
      siteName: SITE.name,
      locale: localeTags[locale as Locale] ?? localeTags.fr,
      type: 'website',
    },
    robots: { index: true, follow: true },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  // Permet le rendu statique des pages de cette langue.
  setRequestLocale(locale)

  const t = await getTranslations('nav')

  return (
    <html
      lang={locale}
      dir="ltr"
      className={`${fraunces.variable} ${interTight.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>
          <ToastProvider>
            <FavoritesProvider>
              <a
                href="#contenu"
                className="skip-link bg-surface px-3 py-2 text-base"
              >
                {t('skipToContent')}
              </a>

              <SiteHeader />

              <main id="contenu" className="flex-1">
                {children}
              </main>

              <SiteFooter />
            </FavoritesProvider>
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
