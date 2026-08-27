import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { listLeafCategories } from '@/lib/db/queries/admin-articles'
import { ArticleForm, EMPTY_ARTICLE } from '@/components/admin/article-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('articles.new'), robots: { index: false, follow: false } }
}

/**
 * Une nouvelle pièce.
 *
 * ---------------------------------------------------------------------------
 * Elle naît en BROUILLON, toujours
 * ---------------------------------------------------------------------------
 * À cet instant, elle n'a aucune photo — on vient de la décrire. Publier
 * d'emblée produirait une vignette vide au catalogue, et la mise en vente est
 * d'ailleurs refusée sans visuel. Le formulaire enregistre donc, puis renvoie
 * vers la fiche, où l'on ajoute les photos et où le bouton « Publier »
 * apparaît.
 */
export default async function NewArticlePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin.articles')

  // Toutes les feuilles, y compris VIDES : c'est précisément la catégorie
  // encore vide que la boutiquière cherche le jour où elle range sa première
  // pièce.
  const categories = await listLeafCategories(locale)

  return (
    <div>
      <h1 className="text-2xl">{t('new')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('newIntro')}</p>

      <div className="mt-8">
        <ArticleForm
          mode="create"
          locale={locale}
          values={EMPTY_ARTICLE}
          categories={categories}
        />
      </div>
    </div>
  )
}
