import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { Link } from '@/lib/i18n/navigation'
import { confirmMagicLinkAction } from '@/lib/auth/magic-link-actions'
import { isMagicCallbackUrl } from '@/lib/auth/magic-link-guard'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth.magicConfirm' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Confirmation d'un lien de connexion.
 *
 * ---------------------------------------------------------------------------
 * Cette page n'est pas une formalité
 * ---------------------------------------------------------------------------
 * Elle existe parce qu'un rappel de lien magique est un GET, et qu'un GET
 * s'exécute sans que personne l'ait voulu : il suffit d'une image dont la
 * source est cette adresse. Quelqu'un demandait un lien pour sa propre adresse
 * et l'amenait devant une victime, dont le navigateur se retrouvait connecté
 * au compte de l'attaquant — puis dont l'adresse postale et le téléphone
 * atterrissaient sur une commande qui ne lui appartenait pas.
 *
 * Le bouton transforme ce GET en POST, que le contrôle d'origine de Next
 * refuse depuis un autre site. C'est le geste qui fait la différence, et c'est
 * pour cela qu'on le demande explicitement plutôt que de le déclencher au
 * chargement.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'on dit, et ce qu'on ne dit pas
 * ---------------------------------------------------------------------------
 * L'adresse concernée n'est PAS affichée. La page s'ouvre sur simple
 * possession du lien : y écrire l'adresse la révélerait à qui a intercepté le
 * message, sans rien apporter à qui l'a demandé — elle sait quelle adresse
 * elle a saisie.
 */
export default async function MagicLinkConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ suite?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const { suite } = await searchParams
  const t = await getTranslations('auth.magicConfirm')

  // Contrôlé ici pour l'affichage, et REVALIDÉ dans l'action : une page ne
  // protège pas l'action qu'elle appelle, chacune se garde elle-même.
  const valid = typeof suite === 'string' && isMagicCallbackUrl(suite)

  return (
    <div className="mx-auto w-full max-w-[32rem] px-4 pb-24 pt-16 sm:px-6">
      <h1 className="text-2xl">{t('title')}</h1>

      {valid ? (
        <>
          <p className="mt-4 text-base text-ink">{t('body')}</p>
          <p className="mt-2 text-sm text-muted">{t('hint')}</p>

          <form action={confirmMagicLinkAction} className="mt-8">
            <input type="hidden" name="suite" value={suite} />
            <Button type="submit" fullWidth>
              {t('confirm')}
            </Button>
          </form>
        </>
      ) : (
        <div className="mt-6">
          <Notice tone="warning" role="alert">
            <p>{t('invalid')}</p>
          </Notice>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/connexion">{t('backToSignIn')}</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
