import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { WithdrawalForm } from '@/components/shop/withdrawal-form'
import { orderNumberSchema } from '@/lib/validation/withdrawal'
import { PAGE_PRIVEE } from '@/lib/seo/metadata'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'withdrawal' })
  return {
    title: t('title'),
    description: t('metaDescription'),
    // Ni indexée ni suivie : c'est un geste, pas un contenu. Le lien qui y
    // mène est en pied de CHAQUE page, et c'est là que la loi le veut —
    // « facilement accessible », pas trouvable par un moteur.
    ...PAGE_PRIVEE,
  }
}

/**
 * « Renoncer au contrat ici » — la fonction de rétractation en ligne.
 *
 * Obligatoire depuis le 19 juin 2026 pour tout contrat conclu sur une
 * interface en ligne (directive 2023/2673, art. 11 bis de la directive
 * 2011/83). Accessible SANS compte : le paiement sans compte est autorisé, et
 * conditionner la rétractation à une connexion ferait obstacle à un droit que
 * l'achat, lui, n'exigeait pas.
 *
 * Le numéro de commande peut arriver dans l'adresse — c'est ainsi que l'e-mail
 * de confirmation et la page de suivi y mènent. L'adresse e-mail, jamais :
 * elle finirait dans l'historique du navigateur et les journaux du serveur.
 */
export default async function WithdrawalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ commande?: string | string[] }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const { commande } = await searchParams
  // Une valeur illisible est ignorée, pas signalée : le champ reste vide et
  // la personne le remplit — exactement comme sans paramètre.
  const prerempli = orderNumberSchema.safeParse(
    Array.isArray(commande) ? commande[0] : commande,
  )

  const t = await getTranslations('withdrawal')
  const tf = await getTranslations('footer')

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-xl">{t('title')}</h1>
      <p className="mt-3 text-sm text-muted">{t('intro')}</p>

      <div className="mt-8">
        <WithdrawalForm
          initialOrderNumber={prerempli.success ? prerempli.data : undefined}
        />
      </div>

      <section className="mt-10 flex flex-col gap-2 border-t border-sand pt-6">
        <h2 className="label-reg text-muted">{t('afterTitle')}</h2>
        <p className="text-sm text-ink">{t('afterReturn')}</p>
        <p className="text-sm text-ink">{t('afterRefund')}</p>
      </section>

      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
        <Link
          href="/pages/retours"
          className="text-ink underline underline-offset-4"
        >
          {tf('returns')}
        </Link>
        <Link
          href="/pages/contact"
          className="text-ink underline underline-offset-4"
        >
          {tf('contact')}
        </Link>
      </p>
    </div>
  )
}
