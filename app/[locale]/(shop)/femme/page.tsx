import type { Metadata } from 'next'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { UniversePage } from '@/components/shop/universe-page'
import { localeAlternates } from '@/lib/i18n/alternates'

/**
 * La vitrine « femme ».
 *
 * Tout le contenu vit dans `UniversePage` : ce fichier n'existe que pour
 * donner à l'univers une ADRESSE propre — canonique, traduite en huit langues,
 * annonçable au plan de site — plutôt qu'un paramètre de catalogue.
 */

type Params = Promise<{ locale: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'catalogue' })

  return {
    title: t('audiences.femme'),
    alternates: localeAlternates(locale, '/femme'),
  }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <UniversePage
      universe="femme"
      locale={locale}
      searchParams={await searchParams}
    />
  )
}
