import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from '@/lib/i18n/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/lib/i18n/navigation'

/**
 * Rendu dynamique explicite.
 *
 * Next le déduit déjà de la lecture de session (vérifié : la réponse porte
 * `Cache-Control: private, no-store` même sans cette ligne). On la garde
 * comme garantie : une page de compte ne doit jamais devenir cacheable à la
 * faveur d'un remaniement qui déplacerait la lecture de session ailleurs.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'account' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Le middleware n'a vérifié que la présence du cookie : le contrôle qui
  // fait autorité est ici, contre la base.
  const user = await getCurrentUser()
  if (!user) {
    redirect({ href: '/connexion', locale })
    // `redirect` de next-intl n'est pas typé `never` : ce retour est
    // inatteignable, il sert uniquement à l'affinage de type.
    return null
  }

  const t = await getTranslations('account')
  const tp = await getTranslations('privacy')

  const sections = [
    { href: '/compte/commandes', label: t('orders') },
    { href: '/compte/offres', label: t('offers') },
    { href: '/favoris', label: t('favorites') },
    { href: '/compte/messages', label: t('messages') },
    { href: '/compte/retours', label: t('returns') },
    { href: '/compte/alertes', label: t('alerts') },
    { href: '/compte/parametres', label: t('settings') },
    { href: '/compte/donnees', label: tp('myData.title') },
  ] as const

  return (
    <div className="mx-auto w-full max-w-[60rem] px-4 pb-24 pt-12 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl">
          {t('greeting', { name: user.firstName ?? user.email })}
        </h1>
        {user.role === 'ADMIN' ? <Badge tone="stamp">Administration</Badge> : null}
      </div>

      <ul className="mt-8 grid gap-px overflow-hidden rounded-card ruled bg-sand sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="flex min-h-[56px] items-center bg-surface px-4 text-base text-ink transition-colors duration-150 ease-out hover:bg-paper-raised"
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>

      {user.role === 'ADMIN' ? (
        <Link
          href="/admin"
          className="mt-8 inline-block text-base text-ink underline underline-offset-4"
        >
          Accéder au back-office
        </Link>
      ) : null}
    </div>
  )
}
