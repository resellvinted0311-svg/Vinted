import { getTranslations, setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/db/client'
import { Wordmark } from '@/components/shop/wordmark'

/**
 * Rendu statique régénéré toutes les 60 secondes.
 *
 * L'accueil porte le référencement et la cible LCP : il reste prérendu. En
 * Phase 2, la régénération sera aussi déclenchée à la demande au changement
 * de statut d'un article, pour qu'une pièce vendue disparaisse de la vitrine
 * sans attendre l'échéance.
 */
export const revalidate = 60

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('home')

  // Phase 0 : on ne fait que constater l'état du catalogue. La grille
  // éditoriale et les entrées par catégorie arrivent en Phase 1.
  const availableCount = await prisma.article.count({
    where: { status: 'AVAILABLE' },
  })

  return (
    <>
      {/* Ouverture éditoriale : la signature respire, rien ne l'encadre. */}
      <section className="border-b border-sand">
        <div className="mx-auto max-w-[80rem] px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <Wordmark size="lg" />
            <p className="mt-8 text-lg text-ink">{t('intro')}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
        <h2 className="text-xl">{t('newArrivals')}</h2>

        {availableCount === 0 ? (
          <div className="mt-6 border border-sand bg-surface p-8 rounded-card">
            <p className="text-base text-ink">{t('emptyCatalogue')}</p>
            <p className="mt-1 text-xs text-muted">{t('emptyCatalogueHint')}</p>
          </div>
        ) : (
          <p className="mt-6 text-base text-muted tabular">
            {availableCount}
          </p>
        )}
      </section>

      {/* Grille asymétrique : la première colonne est plus large que les deux
          suivantes, pour éviter le rendu « trois cartes identiques ». */}
      <section className="border-t border-sand bg-paper-raised">
        <div className="mx-auto max-w-[80rem] px-4 py-12 sm:px-6">
          <h2 className="text-xl">{t('howItWorks.title')}</h2>

          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
            <article>
              <h3 className="text-lg">{t('howItWorks.sourcingTitle')}</h3>
              <p className="mt-2 text-base text-muted">
                {t('howItWorks.sourcingBody')}
              </p>
            </article>

            <article>
              <h3 className="text-lg">{t('howItWorks.selectionTitle')}</h3>
              <p className="mt-2 text-base text-muted">
                {t('howItWorks.selectionBody')}
              </p>
            </article>

            <article>
              <h3 className="text-lg">{t('howItWorks.shippingTitle')}</h3>
              <p className="mt-2 text-base text-muted">
                {t('howItWorks.shippingBody')}
              </p>
            </article>
          </div>
        </div>
      </section>
    </>
  )
}
