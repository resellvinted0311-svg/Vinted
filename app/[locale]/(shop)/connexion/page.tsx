import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from '@/lib/i18n/navigation'
import { Link } from '@/lib/i18n/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { isAuthConfigured } from '@/lib/config/site'
import { SignInForm } from '@/components/shop/sign-in-form'

/** Lit la session pour rediriger une personne déjà connectée. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return {
    title: t('signInTitle'),
    // Une page de connexion n'a rien à faire dans un index.
    robots: { index: false, follow: false },
  }
}

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getCurrentUser()
  if (user) redirect({ href: '/compte', locale })

  const t = await getTranslations('auth')

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-xl">{t('signInTitle')}</h1>

      {/* Sans secret de signature, Auth.js ne peut ouvrir aucune session. On
          le dit franchement plutôt que de laisser le formulaire échouer sans
          explication. Le reste de la boutique reste consultable. */}
      {!isAuthConfigured() ? (
        <p className="mt-6 rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-base text-muted">
          L’authentification n’est pas configurée sur ce déploiement : la
          variable d’environnement <code>AUTH_SECRET</code> est absente.
          La navigation et le catalogue fonctionnent normalement.
        </p>
      ) : null}

      <div className="mt-8">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>

      <p className="mt-8 text-xs text-muted">
        {t('noAccount')}{' '}
        <Link
          href="/inscription"
          className="text-ink underline underline-offset-4"
        >
          {t('signUp')}
        </Link>
      </p>
    </div>
  )
}
