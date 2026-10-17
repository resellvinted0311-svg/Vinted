import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { lireGrillesEditables } from '@/lib/admin/shipping-rates'
import { ShippingForm } from '@/components/admin/shipping-form'
import { PAGE_PRIVEE } from '@/lib/seo/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin.shipping' })
  return { title: t('title'), ...PAGE_PRIVEE }
}

/**
 * Les tarifs de port.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet écran existe
 * ---------------------------------------------------------------------------
 * `prisma/seed-data/shipping.ts` annonce que ses montants sont fictifs, qu'ils
 * ne doivent jamais être remplacés par les tarifs réellement négociés, et que
 * « les vrais tarifs vivent dans la table `ShippingRate` de la base de
 * production ».
 *
 * Rien ne permettait de les y écrire. La boutique facturait donc des prix de
 * port inventés, et le seul chemin vers un prix juste passait par l'édition
 * d'un fichier du dépôt — c'est-à-dire par la publication d'un chiffre
 * d'exploitation dans un dépôt public.
 *
 * `requireAdmin()` est appelé ici bien que la mise en page le fasse déjà :
 * c'est la règle du cahier des charges, et la mémorisation par rendu fait que
 * les deux appels ne coûtent qu'une lecture.
 */
export default async function AdminShippingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Rattrapé plutôt que laissé remonter : sans cela, chaque accès refusé
  // inscrivait une erreur non gérée dans les journaux du serveur, à côté du
  // 404 que la mise en page produisait déjà correctement.
  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin.shipping')
  const zones = await lireGrillesEditables()

  return (
    <div>
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      <div className="mt-8">
        {/*
          Aucune zone : la boutique ne dessert aucun pays, donc la liste du
          tunnel de commande est vide et PERSONNE ne peut commander. Ce n'est
          pas un écran vide à décorer, c'est une panne à annoncer.
        */}
        {zones.length === 0 ? (
          <p className="max-w-prose text-sm">{t('noZones')}</p>
        ) : (
          <ShippingForm zones={zones} />
        )}
      </div>
    </div>
  )
}
