import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { isAuthConfigured } from '@/lib/config/site'
import { PasswordResetRequestForm } from '@/components/shop/password-reset-forms'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return {
    title: t('reset.requestTitle'),
    // Ni indexée ni suivie : cette page n'a rien à faire dans un moteur, et
    // les liens qu'elle porte encore moins.
    robots: { index: false, follow: false },
  }
}

/**
 * « J'ai oublié mon mot de passe ».
 *
 * ---------------------------------------------------------------------------
 * Ce chemin n'existait pas
 * ---------------------------------------------------------------------------
 * `UserToken` était déclarée depuis la première migration, purgée à échéance,
 * effacée avec le compte — et écrite par rien. Le lien magique servait de porte
 * de secours, mais rien ne le disait : une personne qui a choisi un mot de
 * passe cherche un chemin qui porte ce nom, pas « recevoir un lien de
 * connexion ».
 */
export default async function PasswordResetRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('auth')

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-xl">{t('reset.requestTitle')}</h1>
      <p className="mt-3 text-sm text-muted">{t('reset.requestIntro')}</p>

      {/* Sans secret de signature, la session qui suit la réinitialisation ne
          vaudrait rien : la personne poserait un mot de passe puis se
          retrouverait déconnectée sans comprendre. */}
      {!isAuthConfigured() ? (
        <p className="mt-6 rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-base text-muted">
          {t('errors.notConfigured')}
        </p>
      ) : (
        <div className="mt-8">
          <PasswordResetRequestForm />
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        <Link href="/connexion" className="text-ink underline underline-offset-4">
          {t('reset.backToSignIn')}
        </Link>
      </p>
    </div>
  )
}
