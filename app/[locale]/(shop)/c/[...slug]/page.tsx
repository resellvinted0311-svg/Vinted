import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'
import { getCategoryByPath } from '@/lib/db/queries/taxonomy'
import { CatalogueView } from '@/components/shop/catalogue-view'
import { Breadcrumbs } from '@/components/shop/breadcrumbs'
import { locales, localeTags } from '@/lib/i18n/routing'

type Params = Promise<{ locale: string; slug: string[] }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { locale, slug } = await params
  const category = await getCategoryByPath(slug, locale)
  if (!category) return {}

  const path = `/${locale}/c/${slug.join('/')}`
  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/c/${slug.join('/')}`]),
  )
  languages['x-default'] = `/fr/c/${slug.join('/')}`

  return {
    title: category.seoTitle ?? category.name,
    description: category.seoDescription ?? undefined,
    alternates: { canonical: path, languages },
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const category = await getCategoryByPath(slug, locale)
  // Une catégorie inexistante est un vrai 404 : contrairement à un article
  // vendu, il n'y a pas de référencement à préserver.
  if (!category) notFound()

  const raw = await searchParams
  const { filters, sort, cursor } = parseCatalogueSearchParams(raw)
  const t = await getTranslations('nav')

  return (
    <>
      <div className="mx-auto max-w-[80rem] px-4 pt-6 sm:px-6">
        <Breadcrumbs
          items={[
            { href: '/catalogue', label: t('catalogue') },
            ...category.ancestors.map((ancestor, index) => ({
              href: `/c/${slug.slice(0, index + 1).join('/')}`,
              label: ancestor.name,
            })),
            { href: null, label: category.name },
          ]}
        />
      </div>

      <CatalogueView
        basePath={`/c/${slug.join('/')}`}
        // Le filtre de catégorie est imposé par l'URL : il n'apparaît pas
        // dans les pastilles retirables.
        filters={{ ...filters, categorySlugs: [category.slug] }}
        sort={sort}
        cursor={cursor}
        locale={locale}
        lockedDimensions={['categorySlugs']}
        heading={category.name}
        intro={category.editorialBody}
      />
    </>
  )
}
