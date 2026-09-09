import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'
import { getCategoryByPath } from '@/lib/db/queries/taxonomy'
import { CatalogueView } from '@/components/shop/catalogue-view'
import { Breadcrumbs } from '@/components/shop/breadcrumbs'
import { CategoryBanner } from '@/components/shop/category-banner'
import { bannerFor } from '@/lib/design/category-banners'
import { locales, localeTags } from '@/lib/i18n/routing'
import { descriptionCourte } from '@/lib/seo/metadata'

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

  const tSeo = await getTranslations({ locale, namespace: 'seo' })

  const path = `/${locale}/c/${slug.join('/')}`
  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/c/${slug.join('/')}`]),
  )
  languages['x-default'] = `/fr/c/${slug.join('/')}`

  return {
    title: category.seoTitle ?? category.name,
    /*
      Le repli n'est PAS `undefined`.

      Sans description, la page héritait de celle de la mise en page — la
      baseline du site, cinq mots identiques sur toutes les pages. Un moteur
      qui voit la même description sur trente rayons n'en garde aucune : il
      compose l'extrait à partir du contenu de la page, c'est-à-dire ici d'une
      grille de vignettes. La description rédigée à la main reste prioritaire ;
      celle-ci prend le relais tant qu'il n'y en a pas.
    */
    description:
      category.seoDescription ??
      descriptionCourte(tSeo('category', { category: category.name })),
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

  // Un rayon sans photographie déclarée garde son lavis d'accent : c'est un
  // état normal, pas une image manquante.
  const bandeau = bannerFor(category.slug)

  const raw = await searchParams
  const { filters, sort, cursor } = parseCatalogueSearchParams(raw)
  const t = await getTranslations('nav')

  return (
    <>
      {/*
        Le bandeau ouvre la page, avant le fil d'Ariane.

        C'est l'ordre d'une page de rayon en magasin : on voit d'abord
        l'enseigne du rayon, on regarde ensuite par où l'on est arrivé. Mis
        sous le fil, le bandeau perdrait sa fonction — annoncer où l'on vient
        d'atterrir — pour devenir une illustration au milieu de la page.

        Il porte le `h1`, que `CatalogueView` cesse donc d'écrire.
      */}
      <CategoryBanner
        title={category.name}
        intro={category.editorialBody}
        imageUrl={bandeau?.src ?? null}
        cadrage={bandeau?.cadrage ?? '50% 50%'}
        zoom={bandeau?.zoom ?? 1}
        alt={bandeau?.alt ?? ''}
      />

      <div className="mx-auto max-w-[var(--colonne)] px-4 pt-6 sm:px-6">
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
        // Le titre et l'accroche sont déjà dans le bandeau, au-dessus. Les
        // laisser ici en ferait un doublon, et surtout un second `h1`.
        hideHeading
      />
    </>
  )
}
