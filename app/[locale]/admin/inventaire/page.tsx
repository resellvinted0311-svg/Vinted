import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { InventorySync } from '@/components/admin/inventory-sync'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'

export const dynamic = 'force-dynamic'

/**
 * Durée maximale, en secondes.
 *
 * Elle vaut aussi pour la Server Action appelée par cette page : une action est
 * un POST vers l'URL de la page qui l'a rendue, et hérite donc de sa
 * configuration de segment. L'action, elle, s'arrête à quarante secondes — la
 * marge paie le rendu de sa réponse.
 */
export const maxDuration = 60

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('inventory.title'), robots: { index: false, follow: false } }
}

/**
 * Synchroniser l'inventaire de l'application vers la boutique.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet écran, alors qu'une tâche planifiée fait le travail
 * ---------------------------------------------------------------------------
 * La tâche planifiée passe une fois par jour et reprend là où elle s'est
 * arrêtée : c'est ce qu'il faut pour SUIVRE les changements — une pièce mise en
 * vente paraît, une pièce vendue disparaît, sans que personne n'ouvre rien.
 *
 * Elle est en revanche beaucoup trop lente pour le PREMIER import, qui porte
 * tout le stock d'un coup. Cet écran fait exactement le même travail, à la
 * demande, et le répète jusqu'à ce qu'il ne reste rien.
 *
 * Il remplace un script de ligne de commande et cinq variables d'environnement
 * à recharger à chaque terminal. C'était le seul chemin, et ce n'en était pas
 * un : une manipulation qu'on redoute est une manipulation qu'on ne fait pas.
 */
export default async function AdminInventoryPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Rattrapé plutôt que laissé remonter : sans cela, chaque accès refusé
  // inscrivait une erreur non gérée dans les journaux du serveur.
  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin.inventory')

  return (
    <div>
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      <div className="mt-8">
        <InventorySync />
      </div>
    </div>
  )
}
