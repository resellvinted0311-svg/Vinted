import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { countPendingOffers } from '@/lib/db/queries/admin-offers'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * L'accueil de la régie.
 *
 * Il ne montre que ce qui ATTEND quelque chose. Un tableau de bord qui affiche
 * des chiffres flatteurs — ventes du mois, visiteurs — se regarde une fois puis
 * s'ignore ; une liste de ce qui expire se consulte tous les jours.
 *
 * `requireAdmin()` est appelé ici bien que le layout le fasse déjà : c'est la
 * règle du cahier des charges, et la mémorisation par rendu fait que les deux
 * appels ne coûtent qu'une lecture.
 */
export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Rattrapé plutôt que laissé remonter : sans cela, chaque accès refusé
  // inscrivait une erreur non gérée dans les journaux du serveur, à côté du
  // 404 que le layout produisait déjà correctement.
  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin')
  const pending = await countPendingOffers()

  return (
    <div>
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
        <li className="flex items-center justify-between gap-4 py-4">
          <Link
            href="/admin/offres"
            className="text-base text-ink underline-offset-4 hover:underline"
          >
            {t('offers')}
          </Link>
          {/*
            Un compteur qui vaut zéro se dit « aucune », pas « 0 » dans une
            pastille : une pastille vide attire l'œil pour rien.
          */}
          {pending > 0 ? (
            <Badge tone="stamp">{t('pendingCount', { count: pending })}</Badge>
          ) : (
            <span className="text-xs text-muted">{t('nothingPending')}</span>
          )}
        </li>
      </ul>
    </div>
  )
}
