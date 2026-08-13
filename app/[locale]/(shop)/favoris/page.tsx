import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/db/client'
import { publicArticleCardSelect } from '@/lib/db/selectors'
import { getFavoriteArticleIds } from '@/lib/shop/favorites'
import {
  ArticleCard,
  ArticleGrid,
  GRID_IMAGE_SIZES,
} from '@/components/shop/article-card'

/** Dépend de la session boutique : jamais mis en cache. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'favorites' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default async function FavoritesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('favorites')
  const ids = await getFavoriteArticleIds()

  // Les favoris sont conservés même quand l'article part : on les affiche
  // toujours, marqués « Vendu », plutôt que de les faire disparaître sans
  // explication.
  const articles =
    ids.length === 0
      ? []
      : await prisma.article.findMany({
          where: { id: { in: ids }, publishedAt: { not: null } },
          select: publicArticleCardSelect,
          orderBy: { publishedAt: 'desc' },
        })

  return (
    <div className="mx-auto max-w-[80rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('title')}</h1>
      <p data-numeric className="mt-1 text-xs text-muted">
        {t('count', { count: articles.length })}
      </p>

      {articles.length === 0 ? (
        <div className="grid-reg mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('empty')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="mt-8">
          <ArticleGrid>
            {articles.map((article, index) => (
              <ArticleCard
                key={article.id}
                article={article}
                locale={locale}
                sizes={GRID_IMAGE_SIZES}
                priority={index < 4}
              />
            ))}
          </ArticleGrid>
        </div>
      )}
    </div>
  )
}
