import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'
import { CatalogueView } from '@/components/shop/catalogue-view'
import { SITE } from '@/lib/config/site'
import { locales, localeTags } from '@/lib/i18n/routing'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'catalogue' })

  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/catalogue`]),
  )
  languages['x-default'] = '/fr/catalogue'

  return {
    title: t('title'),
    alternates: {
      // Canonical sans paramètres : les combinaisons de filtres ne doivent
      // pas concurrencer la page de base dans l'index.
      canonical: `/${locale}/catalogue`,
      languages,
    },
    openGraph: {
      title: `${t('title')} — ${SITE.name}`,
      url: `/${locale}/catalogue`,
    },
  }
}

export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: SearchParams
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const raw = await searchParams
  const { filters, sort, cursor } = parseCatalogueSearchParams(raw)
  const t = await getTranslations('catalogue')
  const ts = await getTranslations('search')

  return (
    <CatalogueView
      basePath="/catalogue"
      filters={filters}
      sort={sort}
      cursor={cursor}
      locale={locale}
      heading={
        filters.query ? ts('resultsFor', { query: filters.query }) : t('title')
      }
    />
  )
}
