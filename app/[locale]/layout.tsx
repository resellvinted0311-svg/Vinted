import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Archivo, Inter_Tight, IBM_Plex_Mono } from 'next/font/google'

import { routing, locales, localeTags, type Locale } from '@/lib/i18n/routing'
import { SITE } from '@/lib/config/site'
import { ToastProvider } from '@/components/ui/toast'
import { FavoritesProvider } from '@/components/shop/favorites-provider'
import { SiteHeader } from '@/components/shop/site-header'
import { SiteFooter } from '@/components/shop/site-footer'

import '../globals.css'

/**
 * Trois rôles, trois familles — c'est le minimum pour que la charte
 * « Registre » tienne, et le maximum pour que le budget de fontes reste sain.
 *
 * Archivo : grotesque serrée conçue pour l'impression à forte densité. Elle
 * porte les titres en capitales et les prix. Fraunces, retenue jusqu'ici, était
 * un serif éditorial : elle appartient à la direction que la refonte remplace.
 *
 * IBM Plex Mono : tout ce qui est donnée — référence d'inventaire, poids,
 * mesures, dates. La chasse fixe est ce qui fait lire un chiffre comme un
 * relevé plutôt que comme un argument.
 *
 * Les trois sont auto-hébergées et sous-ensemblées par next/font : aucune
 * requête vers un tiers, donc aucun consentement à demander pour les charger.
 */
const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-archivo',
  display: 'swap',
  weight: ['500', '600', '700'],
})

const interTight = Inter_Tight({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter-tight',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plex-mono',
  display: 'swap',
  weight: ['400', '500'],
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
      className={`${archivo.variable} ${interTight.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>
          <ToastProvider>
            <FavoritesProvider>
              <a
                href="#contenu"
                className="skip-link rounded-input ruled bg-surface px-3 py-2 text-base"
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
