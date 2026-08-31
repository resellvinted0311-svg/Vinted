import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, getMessages, setRequestLocale } from 'next-intl/server'
import { Archivo, Inter_Tight, IBM_Plex_Mono } from 'next/font/google'

import { routing, locales, localeTags, type Locale } from '@/lib/i18n/routing'
import { SITE } from '@/lib/config/site'

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

  // ---------------------------------------------------------------------------
  // Cette mise en page ne porte plus AUCUNE chrome
  // ---------------------------------------------------------------------------
  // En-tête, pied de page, favoris et notifications sont descendus dans le
  // groupe `(shop)`, où ils décrivent quelque chose. Ils étaient ici, donc la
  // régie les héritait : on gérait son stock à l'intérieur de la vitrine.
  //
  // Ne restent que ce qui vaut pour TOUT le site : le document, les fontes, et
  // les traductions du client.
  // ---------------------------------------------------------------------------
  // L'espace de noms `admin` ne part PAS chez le public
  // ---------------------------------------------------------------------------
  // `NextIntlClientProvider` sans prop `messages` sérialise le fichier de
  // traduction ENTIER dans la charge de chaque page — y compris les libellés de
  // la régie, que personne d'autre que la boutiquière ne verra jamais.
  //
  // Ce n'est pas une fuite de données : ce sont des libellés, pas des valeurs.
  // C'est en revanche du poids inutile sur chaque page publique, et cela expose
  // le vocabulaire interne de la boutique à qui lit la source. Un test
  // d'étanchéité l'a d'ailleurs signalé le jour où l'écran des pièces a ajouté
  // un champ « notes internes ».
  //
  // La régie remet le bloc complet dans son propre fournisseur.
  const { admin: _admin, ...publicMessages } = await getMessages()

  return (
    <html
      lang={locale}
      dir="ltr"
      className={`${archivo.variable} ${interTight.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider messages={publicMessages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
