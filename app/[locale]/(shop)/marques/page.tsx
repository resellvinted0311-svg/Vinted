import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { listBrandsWithCounts } from '@/lib/db/queries/taxonomy'
import { locales, localeTags } from '@/lib/i18n/routing'

/** Le nombre d'articles par marque bouge à chaque vente. */
export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'brands' })

  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/marques`]),
  )
  languages['x-default'] = '/fr/marques'

  return {
    title: t('title'),
    description: t('intro'),
    alternates: { canonical: `/${locale}/marques`, languages },
  }
}

export default async function BrandsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('brands')
  const brands = await listBrandsWithCounts()

  return (
    <div className="mx-auto max-w-[80rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-base text-muted">{t('intro')}</p>

      <ul className="mt-8 grid gap-px overflow-hidden rounded-card ruled bg-sand sm:grid-cols-2 lg:grid-cols-3">
        {brands.map((brand) => (
          <li key={brand.id}>
            <Link
              href={`/marque/${brand.slug}`}
              className="flex min-h-[64px] items-center justify-between gap-3 bg-surface px-4 transition-colors duration-150 ease-out hover:bg-paper-raised"
            >
              <span className="text-base text-ink">{brand.name}</span>
              <span data-numeric className="text-xs text-muted">
                {t('itemCount', { count: brand.articleCount })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
