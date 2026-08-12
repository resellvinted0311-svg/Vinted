import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'
import { getBrandBySlug } from '@/lib/db/queries/taxonomy'
import { CatalogueView } from '@/components/shop/catalogue-view'
import { Breadcrumbs } from '@/components/shop/breadcrumbs'
import { locales, localeTags } from '@/lib/i18n/routing'

type Params = Promise<{ locale: string; brand: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { locale, brand: slug } = await params
  const brand = await getBrandBySlug(slug)
  if (!brand) return {}

  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/marque/${slug}`]),
  )
  languages['x-default'] = `/fr/marque/${slug}`

  return {
    title: brand.name,
    alternates: { canonical: `/${locale}/marque/${slug}`, languages },
  }
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { locale, brand: slug } = await params
  setRequestLocale(locale)

  const brand = await getBrandBySlug(slug)
  if (!brand) notFound()

  const raw = await searchParams
  const { filters, sort, cursor } = parseCatalogueSearchParams(raw)
  const t = await getTranslations('nav')

  return (
    <>
      <div className="mx-auto max-w-[80rem] px-4 pt-6 sm:px-6">
        <Breadcrumbs
          locale={locale}
          items={[
            { href: '/catalogue', label: t('catalogue') },
            { href: '/marques', label: t('brands') },
            { href: null, label: brand.name },
          ]}
        />
      </div>

      <CatalogueView
        basePath={`/marque/${slug}`}
        filters={{ ...filters, brandSlugs: [brand.slug] }}
        sort={sort}
        cursor={cursor}
        locale={locale}
        lockedDimensions={['brandSlugs']}
        heading={brand.name}
      />
    </>
  )
}
