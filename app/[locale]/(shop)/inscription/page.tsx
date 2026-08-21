import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect, Link } from '@/lib/i18n/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { isAuthConfigured } from '@/lib/config/site'
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
  const tp = await getTranslations('privacy')

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-xl">{t('signUpTitle')}</h1>

      {/* L'avertissement existait sur /connexion mais pas ici, alors que
          l'inscription est le chemin où le silence coûtait le plus cher : le
          compte partait en base et devenait inutilisable. */}
      {!isAuthConfigured() ? (
        <p className="mt-6 rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-base text-muted">
          {t('errors.notConfigured')}
        </p>
      ) : null}

      <div className="mt-8">
        <SignUpForm />
      </div>

      {/* Information au moment de la collecte — article 13 du RGPD.
          Elle est ici, sous le formulaire, et non reléguée dans un lien de
          pied de page : l'obligation porte sur le moment où la donnée est
          demandée, pas sur l'existence d'une page quelque part. */}
      <p className="mt-6 text-xs text-muted">
        {tp('collectionNotice')}{' '}
        <Link
          href="/pages/confidentialite"
          className="text-ink underline underline-offset-4"
        >
          {tp('collectionLink')}
        </Link>
      </p>

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
