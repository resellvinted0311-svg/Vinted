import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { SettingsForm } from '@/components/admin/settings-form'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import { prisma } from '@/lib/db/client'
import { EDITABLE_SETTINGS } from '@/lib/config/settings'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('settings.title'), robots: { index: false, follow: false } }
}

/**
 * Les réglages métier de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet écran est la CONDITION du reste
 * ---------------------------------------------------------------------------
 * Ces nombres décident des prix : ce que la boutique gagne par pièce, ce
 * qu'elle prend sur chaque colis, jusqu'où elle cède et au bout de combien de
 * temps. Ils vivaient dans `prisma/seed.ts` — donc dans un dépôt public, donc
 * lisibles par n'importe qui, historique compris.
 *
 * Ils n'y sont plus. Le seed ne pose que des valeurs explicitement fictives, et
 * les vraies n'existent que dans la base de production, saisies ici. C'est ce
 * qui permet de les changer sans redéployer et sans jamais les écrire dans un
 * fichier — les deux exigences à la fois.
 *
 * ---------------------------------------------------------------------------
 * Les valeurs sont lues BRUTES, pas par les accesseurs métier
 * ---------------------------------------------------------------------------
 * `getPricingConfig()` refuse de servir en production tant que le profil vaut
 * `development`. Or c'est précisément l'écran par lequel on sort de cet état :
 * passer par l'accesseur rendrait la page inaccessible exactement quand elle est
 * nécessaire — une boutique qu'on ne peut plus configurer parce qu'elle n'est
 * pas configurée.
 *
 * ---------------------------------------------------------------------------
 * Rien de ce qui est ici ne sort de la table `Setting`
 * ---------------------------------------------------------------------------
 * Aucune donnée personnelle, aucun coût d'article. La lecture est un
 * `findMany` sur les seules clés de la liste fermée, jamais un `SELECT *`
 * renvoyé tel quel.
 */
export default async function AdminSettingsPage({
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

  const t = await getTranslations('admin.settings')

  const keys = EDITABLE_SETTINGS.map((field) => field.key)
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...keys, 'settingsProfile'] } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((row) => [row.key, row.value]))

  const values: Record<string, string> = {}
  for (const field of EDITABLE_SETTINGS) {
    values[field.key] = toFormValue(field.kind, byKey.get(field.key))
  }

  const profile =
    byKey.get('settingsProfile') === 'production' ? 'production' : 'development'

  return (
    <div>
      <h1 className="text-2xl">{t('title')}</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      <div className="mt-8">
        <SettingsForm
          fields={EDITABLE_SETTINGS}
          values={values}
          profile={profile}
        />
      </div>
    </div>
  )
}

/**
 * La valeur stockée, telle qu'elle se saisit.
 *
 * Défensive : `Setting.value` est une colonne `Json`. Une valeur mal formée —
 * écrite à la main, ou par une version antérieure du code — doit produire un
 * champ vide qu'on corrige, pas un rendu qui échoue et rend l'écran de
 * correction inaccessible.
 */
function toFormValue(kind: string, value: unknown): string {
  if (kind === 'boolean') return value === true ? 'true' : 'false'

  if (kind === 'dropSchedule') {
    if (!Array.isArray(value)) return ''
    return value
      .filter(
        (stage): stage is { days: number; percent: number } =>
          typeof stage === 'object' &&
          stage !== null &&
          typeof (stage as { days?: unknown }).days === 'number' &&
          typeof (stage as { percent?: unknown }).percent === 'number',
      )
      .map((stage) => `${stage.days}:${stage.percent}`)
      .join('\n')
  }

  // `null` est une valeur légitime pour le seuil d'acceptation automatique :
  // elle se saisit par un champ vide, et se relit comme tel.
  if (value === null || value === undefined) return ''
  return typeof value === 'number' ? String(value) : ''
}
