import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect, Link } from '@/lib/i18n/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { SignUpForm } from '@/components/shop/sign-up-form'

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
    title: t('signUpTitle'),
    robots: { index: false, follow: false },
  }
}

export default async function SignUpPage({
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
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-xl">{t('signUpTitle')}</h1>

      <div className="mt-8">
        <SignUpForm />
      </div>

      <p className="mt-8 text-xs text-muted">
        {t('hasAccount')}{' '}
        <Link
          href="/connexion"
          className="text-ink underline underline-offset-4"
        >
          {t('signIn')}
        </Link>
      </p>
    </div>
  )
}
