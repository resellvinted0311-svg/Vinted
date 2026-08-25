import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { Notice } from '@/components/ui/notice'
import { lookupPasswordReset } from '@/lib/auth/password-reset'
import { PasswordResetForm } from '@/components/shop/password-reset-forms'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return {
    title: t('reset.setTitle'),
    // `follow: false` compte autant qu'`index: false` ici : l'URL PORTE le
    // jeton. Une page suivie enverrait un robot le consommer.
    robots: { index: false, follow: false },
  }
}

/**
 * Le choix du nouveau mot de passe.
 *
 * ---------------------------------------------------------------------------
 * Cette page VÉRIFIE le jeton, elle ne le CONSOMME pas
 * ---------------------------------------------------------------------------
 * Le défaut qu'on évite frappe des gens parfaitement légitimes : les filtres
 * antivirus des messageries d'entreprise suivent les liens des messages
 * entrants pour les inspecter. Un jeton consommé au rendu serait brûlé avant
 * que la personne n'ait cliqué, et elle lirait « ce lien n'est plus valide »
 * sur un lien qu'elle n'a jamais ouvert.
 *
 * La consommation a donc lieu à l'envoi du formulaire, dans une action
 * serveur, par un UPDATE conditionnel. C'est le même raisonnement que celui qui
 * a fait naître la page de confirmation du lien magique.
 *
 * ---------------------------------------------------------------------------
 * Le jeton dans l'URL, et ce qui le protège
 * ---------------------------------------------------------------------------
 * Un lien reçu par e-mail ne peut pas transporter son secret autrement. Trois
 * choses limitent la portée : `Referrer-Policy: strict-origin-when-cross-origin`
 * (posé dans `next.config.ts`) empêche la fuite du chemin vers un tiers ; la
 * politique de sécurité de contenu de cette page est la stricte, sans
 * `unsafe-inline` ; et le jeton ne vit que trente minutes, à usage unique.
 *
 * ---------------------------------------------------------------------------
 * Un seul message pour les trois refus
 * ---------------------------------------------------------------------------
 * Inconnu, déjà utilisé, expiré : « ce lien n'est plus valide ». Distinguer
 * apprendrait à qui tâtonne si son jeton a un jour existé.
 */
export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  setRequestLocale(locale)

  const t = await getTranslations('auth')
  const found = await lookupPasswordReset(token)

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-xl">{t('reset.setTitle')}</h1>

      {found.ok ? (
        <>
          <p className="mt-3 text-sm text-muted">{t('reset.setIntro')}</p>
          <div className="mt-8">
            <PasswordResetForm token={token} />
          </div>
        </>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <Notice tone="warning" role="status">
            <p>{t('errors.invalidLink')}</p>
          </Notice>
          <p className="text-xs text-muted">
            <Link
              href="/connexion/mot-de-passe"
              className="text-ink underline underline-offset-4"
            >
              {t('reset.requestAgain')}
            </Link>
          </p>
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
