import { getTranslations } from 'next-intl/server'
import { getCategoryCovers, hasSortedAudiences } from '@/lib/db/queries/articles'
import { listShowcaseCategories } from '@/lib/db/queries/taxonomy'
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

  /**
   * L'univers n'est imposé QUE s'il trie réellement quelque chose.
   *
   * Tant qu'aucune pièce ne porte « femme » ni « mixte », cette contrainte ne
   * restreint pas : elle vide. La page affichait « aucun article » alors que
   * chaque rayon en dessous était plein, et chaque carte de rayon menait à une
   * grille déserte — un cul-de-sac fabriqué par un filtre qui ne sert encore à
   * rien.
   *
   * La même décision gouverne les trois usages : la grille, les liens des
   * cartes, et la pastille verrouillée. Les séparer, c'est se retrouver avec
   * des cartes qui marchent au-dessus d'une grille vide, ce qui est exactement
   * ce qui vient d'arriver.
   *
   * Rien à faire le jour où le rangement commencera : la réponse bascule
   * d'elle-même dès la première pièce rangée.
   */
  const trieQuelqueChose = await hasSortedAudiences(audiences)
  const imposes = trieQuelqueChose ? { ...filters, audiences } : filters

  const [rayons, covers, t, tc, tNav] = await Promise.all([
    // Les rayons viennent de la TAXONOMIE, pas du stock : ils s'affichent que
    // la boutique soit rangée ou non. C'est le défaut qui rendait cette page
    // vide en production.
    listShowcaseCategories(locale),
    getCategoryCovers(trieQuelqueChose ? audiences : []),
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
        entries={rayons}
        covers={covers}
        audiences={trieQuelqueChose ? audiences : []}
      />

      <CatalogueView
        basePath={`/${universe}`}
        filters={imposes}
        sort={sort}
        cursor={cursor}
        locale={locale}
        // Verrouillée seulement quand elle est posée : verrouiller une
        // dimension absente afficherait une pastille « Femme » que rien
        // n'applique, et qui ne se retire pas.
        lockedDimensions={trieQuelqueChose ? ['audiences'] : []}
        heading={titre}
      />
    </>
  )
}
