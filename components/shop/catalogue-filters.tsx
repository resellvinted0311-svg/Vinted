import { getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils/cn'
import { formatPrice } from '@/lib/utils/format'
import type { Facets, FacetEntry } from '@/lib/db/queries/articles'
import type { CatalogueFilters, SortKey } from '@/lib/domain/catalogue'
import { SORT_KEYS } from '@/lib/domain/catalogue'
import { SubmitOnChange } from './submit-on-change'

/**
 * Panneau de filtres.
 *
 * Bâti sur un <form method="GET"> : sans JavaScript, la soumission recharge
 * la page avec les bons paramètres et tout fonctionne. Avec JavaScript, le
 * formulaire se soumet à chaque changement (voir SubmitOnChange), ce qui
 * donne le confort d'un filtrage instantané sans jamais en dépendre.
 *
 * L'état vit dans l'URL, donc la sélection est partageable et indexable.
 */
export async function CatalogueFiltersPanel({
  action,
  facets,
  filters,
  sort,
  locale,
}: {
  action: string
  facets: Facets
  filters: CatalogueFilters
  sort: SortKey
  locale: string
}) {
  const t = await getTranslations('catalogue')
  const tc = await getTranslations('condition')

  return (
    <form
      method="get"
      action={action}
      className="flex flex-col gap-6"
      data-testid="filtres"
    >
      <SubmitOnChange />

      {/* La recherche en cours est conservée à la soumission des filtres :
          sans ce champ caché, filtrer effacerait la requête. */}
      {filters.query ? (
        <input type="hidden" name="q" value={filters.query} />
      ) : null}

      <fieldset>
        <legend className="label-reg w-full border-b border-sand pb-1.5 text-ink">
          {t('sort')}
        </legend>
        <select
          name="tri"
          defaultValue={sort}
          className="mt-3 min-h-[44px] w-full rounded-input border-[1.5px] border-rule bg-surface px-3 text-base"
        >
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(`sortOptions.${key}`)}
            </option>
          ))}
        </select>
      </fieldset>

      <FacetGroup
        legend={t('facets.category')}
        name="cat"
        entries={facets.categories}
        selected={filters.categorySlugs}
      />

      <FacetGroup
        legend={t('facets.brand')}
        name="marque"
        entries={facets.brands}
        selected={filters.brandSlugs}
      />

      <FacetGroup
        legend={t('facets.size')}
        name="taille"
        entries={facets.sizes}
        selected={filters.sizes}
        columns
      />

      <FacetGroup
        legend={t('facets.condition')}
        name="etat"
        entries={facets.conditions.map((entry) => ({
          ...entry,
          label: tc(`${entry.value}.label`),
        }))}
        selected={filters.conditions}
      />

      <FacetGroup
        legend={t('facets.color')}
        name="couleur"
        entries={facets.colors.map((entry) => ({
          ...entry,
          label: t(`colors.${entry.value}`),
        }))}
        selected={filters.colors}
      />

      <FacetGroup
        legend={t('facets.material')}
        name="matiere"
        entries={facets.materials.map((entry) => ({
          ...entry,
          label: t(`materials.${entry.value}`),
        }))}
        selected={filters.materials}
      />

      {facets.priceRange ? (
        <fieldset>
          <legend className="label-reg w-full border-b border-sand pb-1.5 text-ink">
            {t('facets.price')}
          </legend>
          <p className="data mt-2 text-xs text-muted">
            {formatPrice(facets.priceRange.minCents, locale)} —{' '}
            {formatPrice(facets.priceRange.maxCents, locale)}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <label className="flex-1">
              <span className="sr-only">{t('facets.priceMin')}</span>
              <input
                type="number"
                name="prix_min"
                inputMode="decimal"
                min={0}
                step="1"
                placeholder={t('facets.priceMin')}
                defaultValue={
                  filters.minPriceCents !== null
                    ? String(filters.minPriceCents / 100)
                    : ''
                }
                className="data min-h-[44px] w-full rounded-input border-[1.5px] border-rule bg-surface px-3 text-base"
              />
            </label>
            <span aria-hidden className="text-muted">
              —
            </span>
            <label className="flex-1">
              <span className="sr-only">{t('facets.priceMax')}</span>
              <input
                type="number"
                name="prix_max"
                inputMode="decimal"
                min={0}
                step="1"
                placeholder={t('facets.priceMax')}
                defaultValue={
                  filters.maxPriceCents !== null
                    ? String(filters.maxPriceCents / 100)
                    : ''
                }
                className="data min-h-[44px] w-full rounded-input border-[1.5px] border-rule bg-surface px-3 text-base"
              />
            </label>
          </div>
        </fieldset>
      ) : null}

      {/* Bouton indispensable sans JavaScript : c'est lui qui applique les
          filtres. Il est masqué visuellement quand le script a pris le
          relais, mais reste atteignable au clavier. */}
      <button
        type="submit"
        className="lift min-h-[44px] rounded-input border-[1.5px] border-stamp bg-stamp px-4 text-base font-medium text-ink-inverse"
      >
        {t('apply')}
      </button>
    </form>
  )
}

function FacetGroup({
  legend,
  name,
  entries,
  selected,
  columns = false,
}: {
  legend: string
  name: string
  entries: FacetEntry[]
  selected: string[]
  columns?: boolean
}) {
  if (entries.length === 0) return null

  return (
    <fieldset>
      <legend className="label-reg w-full border-b border-sand pb-1.5 text-ink">
        {legend}
      </legend>

      <div
        className={cn(
          'mt-3 gap-1',
          columns ? 'grid grid-cols-3' : 'flex flex-col',
        )}
      >
        {entries.map((entry) => {
          const checked = selected.includes(entry.value)
          return (
            <label
              key={entry.value}
              className={cn(
                'flex min-h-[36px] cursor-pointer items-center gap-2 text-base',
                'text-ink transition-colors duration-150 ease-out hover:text-stamp',
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={entry.value}
                defaultChecked={checked}
                className="h-4 w-4 shrink-0 accent-[var(--stamp)]"
              />
              <span className="flex-1 truncate">{entry.label}</span>
              <span className="data text-xs text-muted">
                {entry.count}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
