import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect, Link } from '@/lib/i18n/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/client'
import { Button } from '@/components/ui/button'
import {
  MarketingConsentForm,
  EraseAccountForm,
} from '@/components/shop/my-data-forms'

/** Lit la session et l'état du consentement : jamais mis en cache. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'privacy' })
  return { title: t('myData.title'), robots: { index: false, follow: false } }
}

/**
 * Mes données — l'endroit où les droits s'exercent.
 *
 * Les trois opérations que le RGPD demande de rendre faciles sont réunies sur
 * une seule page : obtenir une copie (articles 15 et 20), retirer un
 * consentement (article 7.3), faire effacer son compte (article 17). Aucune
 * ne réclame de justificatif : la session authentifiée prouve déjà qui
 * demande, et exiger une pièce d'identité reviendrait à collecter davantage
 * de données personnelles pour honorer une demande de confidentialité.
 */
export default async function MyDataPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Le middleware n'a vu qu'un cookie : le contrôle qui fait autorité est ici.
  const user = await getCurrentUser()
  if (!user) {
    redirect({ href: '/connexion', locale })
    return null
  }

  const t = await getTranslations('privacy')

  const consent = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { marketingConsent: true },
  })

  return (
    <div className="mx-auto w-full max-w-[46rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-xl">{t('myData.title')}</h1>

      <section className="mt-8 rounded-card ruled bg-paper-raised p-5">
        <h2 className="text-lg">{t('myData.exportTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('myData.exportBody')}</p>
        <div className="mt-4">
          {/* Un vrai téléchargement servi par une route, pas un état React :
              le fichier est enregistré par le navigateur, la personne le
              garde. `prefetch` désactivé — cette adresse renvoie un fichier. */}
          <Button asChild variant="outline">
            <a href="/api/compte/donnees" download>
              {t('myData.exportButton')}
            </a>
          </Button>
        </div>
      </section>

      <section className="mt-6 rounded-card ruled bg-paper-raised p-5">
        <h2 className="text-lg">{t('myData.consentTitle')}</h2>
        <div className="mt-4">
          <MarketingConsentForm granted={consent.marketingConsent} />
        </div>
      </section>

      <section className="mt-6 rounded-card border-[1.5px] border-danger bg-paper-raised p-5">
        <h2 className="text-lg">{t('myData.eraseTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('myData.eraseBody')}</p>
        <div className="mt-4">
          <EraseAccountForm />
        </div>
      </section>

      <p className="mt-8 text-xs text-muted">
        <Link
          href="/pages/confidentialite"
          className="text-ink underline underline-offset-4"
        >
          {t('collectionLink')}
        </Link>
      </p>
    </div>
  )
}
