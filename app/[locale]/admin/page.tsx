import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Notice } from '@/components/ui/notice'
import { lireEtatMiseEnService } from '@/lib/admin/readiness'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { countPendingOffers } from '@/lib/db/queries/admin-offers'
import { countOrdersToFulfil } from '@/lib/db/queries/admin-orders'
import { PAGE_PRIVEE } from '@/lib/seo/metadata'
import { isNegotiationEnabled } from '@/lib/config/site'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('title'), ...PAGE_PRIVEE }
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

  // En parallèle : trois lectures indépendantes, et la production n'accorde
  // qu'une connexion par instance — les enchaîner doublerait l'attente sans
  // rien gagner.
  const [pendingOffers, pendingOrders, miseEnService] = await Promise.all([
    countPendingOffers(),
    countOrdersToFulfil(),
    lireEtatMiseEnService(),
  ])

  return (
    <div>
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      {/*
        AVANT les files, et c'est le point de tout l'écran.

        Une boutique dont le profil de prix est encore celui du jeu de
        démonstration refuse tout import par un 503 que personne ne voit : le
        site s'affiche, le catalogue se parcourt, et la régie annonçait
        « Rien en attente » sur une boutique dans laquelle rien n'entrait.

        Rien n'est rendu quand tout est prêt : c'est la règle de cet écran, qui
        ne montre que ce qui attend quelque chose.
      */}
      {miseEnService.pret ? null : (
        <div className="mt-8">
          <Notice
            tone={miseEnService.bloque ? 'danger' : 'warning'}
            role="status"
            title={
              miseEnService.bloque
                ? t('readiness.blockedTitle')
                : t('readiness.partialTitle')
            }
          >
            <p>
              {miseEnService.bloque
                ? t('readiness.blockedIntro')
                : t('readiness.partialIntro')}
            </p>

            <ul className="mt-4 flex flex-col gap-2">
              {miseEnService.points
                .filter((point) => !point.pret)
                .map((point) => (
                  <li key={point.cle} className="text-sm">
                    <span className="text-ink">
                      {t(`readiness.points.${point.cle}`)}
                    </span>
                    {/*
                      Le détail est une liste de NOMS — variables
                      d'environnement absentes, clés de réglage manquantes.
                      Rendu tel quel, sans traduction : ce sont des
                      identifiants techniques, et les traduire les rendrait
                      introuvables.
                    */}
                    {point.detail ? (
                      <span data-numeric className="text-muted">
                        {' — '}
                        {point.detail}
                      </span>
                    ) : null}
                    {point.bloquant ? null : (
                      <span className="text-muted">
                        {' '}
                        ({t('readiness.nonBlocking')})
                      </span>
                    )}
                  </li>
                ))}
            </ul>

            <p className="mt-4 text-sm">
              <Link
                href="/admin/reglages"
                className="text-ink underline underline-offset-4"
              >
                {t('readiness.openSettings')}
              </Link>
            </p>
          </Notice>
        </div>
      )}

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
        {/*
          La file des offres, seulement si la boutique négocie — OU s'il reste
          des offres en attente. Le second cas est celui d'une négociation
          éteinte après avoir été allumée : masquer la file laisserait des
          propositions sans réponse, avec une échéance qui court, et personne
          pour les voir.
        */}
        {isNegotiationEnabled() || pendingOffers > 0 ? (
          <QueueRow
            href="/admin/offres"
            label={t('offers')}
            count={pendingOffers}
            badge={t('pendingCount', { count: pendingOffers })}
            idle={t('nothingPending')}
          />
        ) : null}
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
