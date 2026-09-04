import { getTranslations } from 'next-intl/server'
import { getFacets, getCategoryCovers } from '@/lib/db/queries/articles'
import { parseCatalogueSearchParams } from '@/lib/validation/catalogue'
import { audiencesFor } from '@/lib/domain/vocabulary'
import { CatalogueView } from './catalogue-view'
import { CategoryCards } from './category-cards'
import { Breadcrumbs } from './breadcrumbs'

/**
 * Une vitrine d'univers : Femme ou Homme.
 *
 * ---------------------------------------------------------------------------
 * Un composant, deux routes
 * ---------------------------------------------------------------------------
 * `/femme` et `/homme` sont deux fichiers de route de quinze lignes qui
 * appellent celui-ci. Une route dynamique `/univers/[genre]` aurait donné un
 * seul fichier — mais une adresse plus profonde pour les deux entrées les plus
 * importantes du site, et un segment qui ne veut rien dire pour la visiteuse.
 *
 * ---------------------------------------------------------------------------
 * L'univers est une dimension IMPOSÉE, pas un filtre coché
 * ---------------------------------------------------------------------------
 * Il est passé en `lockedDimensions` : la pastille « Femme » n'apparaît donc
 * pas dans les filtres actifs, puisqu'elle ne se retire pas — l'enlever
 * mènerait hors de la page qui la porte. Le mécanisme existait déjà pour les
 * pages de marque et de catégorie ; c'est le même, appliqué à une dimension
 * de plus.
 *
 * ---------------------------------------------------------------------------
 * « Femme » veut dire femme ET mixte
 * ---------------------------------------------------------------------------
 * La règle vit dans `audiencesFor`, à un seul endroit : la page l'applique,
 * la carte de la vitrine compte pareil, et le plan de site annonce la même
 * chose. Trois écritures d'une même règle finiraient par diverger.
 */
export async function UniversePage({
  universe,
  locale,
  searchParams,
}: {
  universe: 'femme' | 'homme'
  locale: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const audiences = audiencesFor(universe)

  const { filters, sort, cursor } = parseCatalogueSearchParams(searchParams)
  const imposes = { ...filters, audiences }

  const [facets, covers, t, tc, tNav] = await Promise.all([
    getFacets(imposes, locale),
    getCategoryCovers(audiences),
    getTranslations('home'),
    getTranslations('catalogue'),
    getTranslations('nav'),
  ])

  const titre = tc(`audiences.${universe}`)

  return (
    <>
      <div className="mx-auto max-w-[80rem] px-4 pt-6 sm:px-6">
        <Breadcrumbs
          locale={locale}
          items={[
            { href: '/catalogue', label: tNav('catalogue') },
            { href: null, label: titre },
          ]}
        />
      </div>

      {/*
        Les catégories AVANT la grille.

        C'est l'ordre demandé, et il tient : la personne vient de choisir un
        univers, elle affine avant de parcourir. Poser la grille d'abord
        l'obligerait à faire défiler cinquante pièces pour trouver l'entrée
        « Chaussures ».
      */}
      <CategoryCards
        title={t('shopByCategory')}
        entries={facets.categories}
        covers={covers}
        audiences={audiences}
      />

      <CatalogueView
        basePath={`/${universe}`}
        filters={imposes}
        sort={sort}
        cursor={cursor}
        locale={locale}
        lockedDimensions={['audiences']}
        heading={titre}
      />
    </>
  )
}
