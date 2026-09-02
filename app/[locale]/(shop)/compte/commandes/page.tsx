import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth/session'
import { readCartOwner } from '@/lib/shop/cart'
import { listOrders } from '@/lib/db/queries/orders'
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
 * L'historique des commandes, côté compte.
 *
 * ---------------------------------------------------------------------------
 * Le contrôle du rôle est REFAIT ici
 * ---------------------------------------------------------------------------
 * Le middleware protège déjà `/compte`, mais il ne fait que constater la
 * présence d'un cookie : il tourne sur le moteur périphérique, sans accès à la
 * base. La vérification qui fait autorité est celle-ci.
 *
 * ---------------------------------------------------------------------------
 * Même composant de ligne qu'en visiteur
 * ---------------------------------------------------------------------------
 * Une commande passée sans compte et une commande passée connecté sont la même
 * chose. Les présenter différemment laisserait croire le contraire — et les
 * commandes d'avant l'inscription apparaissent ici, rattachées à la connexion.
 */
export default async function AccountOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}/connexion?suite=/compte/commandes`)

  const t = await getTranslations('order')
  const owner = await readCartOwner()
  const orders = owner ? await listOrders(owner) : []

  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('registerTitle')}</h1>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-card ruled bg-surface p-8">
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
              // Les pages de détail et de facture vivent sous `/commande/suivi`
              // et bornent déjà la lecture au propriétaire. Les redoubler sous
              // `/compte` créerait deux chemins vers le même document, donc
              // deux endroits où se tromper de portée.
              basePath="/commande/suivi"
            />
          ))}
        </ul>
      )}
    </div>
  )
}
