import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import {
  filtersToSearchParams,
  hasActiveFilters,
  withoutFilterValue,
  type CatalogueFilters,
  type SortKey,
} from '@/lib/domain/catalogue'
import { formatPrice } from '@/lib/utils/format'

interface Chip {
  label: string
  href: string
}

/**
 * Filtres actifs, en pastilles retirables.
 *
 * Chaque pastille est un lien vers la même page sans ce filtre : cela
 * fonctionne sans JavaScript, et le retrait est indexable comme n'importe
 * quelle navigation.
 */
export async function ActiveFilterChips({
  basePath,
  filters,
  sort,
  locale,
  labels,
}: {
  basePath: string
  filters: CatalogueFilters
  sort: SortKey
  locale: string
  /** Libellés lisibles par valeur, fournis par la page (slug → nom). */
  labels: Record<string, string>
}) {
  const t = await getTranslations('catalogue')

  if (!hasActiveFilters(filters)) return null

  const hrefFor = (next: CatalogueFilters): string => {
    const params = filtersToSearchParams(next, sort)
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  const chips: Chip[] = []

  const addAll = (
    key: keyof CatalogueFilters,
    values: string[],
  ): void => {
    for (const value of values) {
      chips.push({
        label: labels[value] ?? value,
        href: hrefFor(withoutFilterValue(filters, key, value)),
      })
    }
  }

  addAll('categorySlugs', filters.categorySlugs)
  addAll('brandSlugs', filters.brandSlugs)
  addAll('sizes', filters.sizes)
  addAll('conditions', filters.conditions)
  addAll('colors', filters.colors)
  addAll('materials', filters.materials)

  if (filters.minPriceCents !== null || filters.maxPriceCents !== null) {
    const from =
      filters.minPriceCents !== null
        ? formatPrice(filters.minPriceCents, locale)
        : '…'
    const to =
      filters.maxPriceCents !== null
        ? formatPrice(filters.maxPriceCents, locale)
        : '…'

    chips.push({
      label: `${from} — ${to}`,
      href: hrefFor({ ...filters, minPriceCents: null, maxPriceCents: null }),
    })
  }

  if (filters.query) {
    chips.push({
      label: `« ${filters.query} »`,
      href: hrefFor({ ...filters, query: null }),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only">{t('activeFilters')}</span>

      {chips.map((chip) => (
        <Link
          key={`${chip.label}-${chip.href}`}
          href={chip.href}
          className="label-reg lift inline-flex min-h-[36px] items-center gap-1.5 rounded-input border-[1.5px] border-rule bg-surface px-2.5 text-ink"
        >
          {chip.label}
          <span aria-hidden className="text-muted">
            ×
          </span>
          <span className="sr-only">{t('removeFilter')}</span>
        </Link>
      ))}

      <Link
        href={basePath}
        className="label-reg min-h-[36px] px-1 text-muted underline underline-offset-4 hover:text-ink"
      >
        {t('clearFilters')}
      </Link>
    </div>
  )
}
