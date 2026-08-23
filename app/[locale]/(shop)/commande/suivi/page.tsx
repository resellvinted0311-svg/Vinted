import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { readCartOwner } from '@/lib/shop/cart'
import { listOrders } from '@/lib/db/queries/orders'
import { getCurrentUser } from '@/lib/auth/session'
import { OrderRegisterRow } from '@/components/shop/order/order-register-row'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'order' })
  return { title: t('registerTitle'), robots: { index: false, follow: false } }
}

/**
 * Le registre des commandes, sans compte.
 *
 * ---------------------------------------------------------------------------
 * Ce que « sans compte » veut dire ici
 * ---------------------------------------------------------------------------
 * La liste vient du JETON de session boutique, un cookie httpOnly posé au
 * premier passage. Elle affiche donc les commandes passées depuis CE
 * navigateur — pas celles de qui saurait taper un numéro.
 *
 * ---------------------------------------------------------------------------
 * Aucun formulaire « retrouver ma commande »
 * ---------------------------------------------------------------------------
 * Un champ « numéro de commande + e-mail » paraît anodin. Il ne l'est pas : le
 * numéro est court et séquentiel, l'adresse se devine souvent, et le
 * formulaire devient une machine à essayer des couples. Une commande se
 * retrouve donc depuis le navigateur qui l'a passée, ou depuis le compte
 * auquel elle est rattachée.
 *
 * ---------------------------------------------------------------------------
 * Ce que l'e-mail de confirmation NE fait PAS
 * ---------------------------------------------------------------------------
 * Il ne porte aucun lien vers la commande — ce commentaire l'affirmait, et
 * c'était faux : `lib/providers/email/order.ts` ne construit aucune URL. Il
 * porte le NUMÉRO, ce qui permet de nous écrire, et rien de plus.
 *
 * Un lien signé et borné dans le temps serait le bon dispositif, et il reste à
 * faire. En attendant, l'écran dit ce qui est vrai plutôt que ce qui serait
 * commode.
 */
export default async function OrderRegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('order')
  const owner = await readCartOwner()
  const orders = owner ? await listOrders(owner) : []
  const user = await getCurrentUser()

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('registerTitle')}</h1>

      {orders.length === 0 ? (
        <div className="grid-reg mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('emptyRegister')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyRegisterHint')}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/catalogue">{t('backToCatalogue')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-sand border-y-[1.5px] border-rule">
          {orders.map((order) => (
            <OrderRegisterRow
              key={order.orderNumber}
              order={order}
              basePath="/commande/suivi"
            />
          ))}
        </ul>
      )}

      {/*
        Sans compte, cette liste tient au cookie de session : elle se perd en
        changeant de navigateur ou en effaçant les données du site. On le dit,
        plutôt que de laisser découvrir la disparition.
      */}
      {user ? null : (
        <Notice tone="neutral" role="status" className="mt-8">
          <p>{t('guestRegisterHint')}</p>
        </Notice>
      )}
    </div>
  )
}
