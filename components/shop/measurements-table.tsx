import { getTranslations } from 'next-intl/server'
import { formatCm } from '@/lib/utils/format'

/**
 * Mesures réelles, en centimètres.
 *
 * C'est l'élément qui distingue une vraie fiche d'une annonce entre
 * particuliers : le brief en fait le premier facteur de conversion et de
 * réduction des retours. Le tableau est donc mis en avant, pas replié dans un
 * accordéon.
 *
 * L'ordre est celui du corps, de haut en bas, pas l'ordre alphabétique.
 */
const ORDER = [
  'shoulders',
  'chest',
  'waist',
  'hips',
  'length',
  'sleeve',
  'inseam',
  'footLength',
] as const

export async function MeasurementsTable({
  measurements,
  locale,
}: {
  measurements: { key: string; valueCm: number }[]
  locale: string
}) {
  const t = await getTranslations('measurement')

  if (measurements.length === 0) return null

  const sorted = [...measurements].sort((a, b) => {
    const ia = ORDER.indexOf(a.key as (typeof ORDER)[number])
    const ib = ORDER.indexOf(b.key as (typeof ORDER)[number])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  return (
    <section>
      <h2 className="text-lg">{t('title')}</h2>
      <p className="mt-1 text-xs text-muted">{t('help')}</p>

      <table className="mt-3 w-full border-collapse text-base">
        <caption className="sr-only">{t('title')}</caption>
        <tbody>
          {sorted.map((measurement) => (
            <tr key={measurement.key} className="border-b border-sand">
              <th scope="row" className="py-2 text-left font-normal text-muted">
                {t(`keys.${measurement.key}`)}
              </th>
              <td data-numeric className="py-2 text-right text-ink">
                {formatCm(measurement.valueCm, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
