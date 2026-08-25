import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { countPendingOffers } from '@/lib/db/queries/admin-offers'
import { countOrdersToFulfil } from '@/lib/db/queries/admin-orders'

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

  // En parallèle : deux comptes indépendants, et la production n'accorde qu'une
  // connexion par instance — les enchaîner doublerait l'attente sans rien
  // gagner.
  const [pendingOffers, pendingOrders] = await Promise.all([
    countPendingOffers(),
    countOrdersToFulfil(),
  ])

  return (
    <div>
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
        {/*
          Les commandes avant les offres : un colis qui ne part pas est une
          personne qui a déjà payé et qui attend. Une offre sans réponse
          s'éteint d'elle-même, sans que personne n'ait rien avancé.
        */}
        <QueueRow
          href="/admin/commandes"
          label={t('orders')}
          count={pendingOrders}
          badge={t('ordersPendingCount', { count: pendingOrders })}
          idle={t('nothingPending')}
        />
        <QueueRow
          href="/admin/offres"
          label={t('offers')}
          count={pendingOffers}
          badge={t('pendingCount', { count: pendingOffers })}
          idle={t('nothingPending')}
        />
      </ul>
    </div>
  )
}

/** Une file de travail : ce qu'elle est, et combien il en reste. */
function QueueRow({
  href,
  label,
  count,
  badge,
  idle,
}: {
  href: string
  label: string
  count: number
  badge: string
  idle: string
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <Link
        href={href}
        className="text-base text-ink underline-offset-4 hover:underline"
      >
        {label}
      </Link>
      {/*
        Un compteur qui vaut zéro se dit « aucune », pas « 0 » dans une
        pastille : une pastille vide attire l'œil pour rien.
      */}
      {count > 0 ? (
        <Badge tone="stamp">{badge}</Badge>
      ) : (
        <span className="text-xs text-muted">{idle}</span>
      )}
    </li>
  )
}
