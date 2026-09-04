import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/config/site'
import { PAGE_SLUGS, isPlaceholderPage } from '@/lib/config/pages'
import { locales, localeTags, defaultLocale } from '@/lib/i18n/routing'
import {
  listSitemapArticles,
  listSitemapBrands,
  listSitemapCategories,
  type SitemapResource,
} from '@/lib/db/queries/sitemap'

/**
 * Le plan de site.
 *
 * ---------------------------------------------------------------------------
 * Il n'existait pas, et le hreflang ne vivait que dans les en-têtes
 * ---------------------------------------------------------------------------
 * Chaque page portait bien ses balises `alternate` — mais une balise dans le
 * `<head>` ne se lit qu'une fois la page trouvée. Sans plan de site, un moteur
 * découvre le catalogue en suivant des liens, lot par lot, et n'atteint
 * jamais les pièces situées au-delà du premier « voir la suite » : la
 * pagination par curseur n'expose pas d'adresse de page numérotée à explorer.
 *
 * Pour une boutique de pièces UNIQUES, c'est le pire cas possible : chaque
 * fiche est un contenu qui n'existe qu'une fois, et elle disparaît du stock au
 * bout de quelques semaines. Une page découverte trop tard ne sera jamais
 * découverte.
 *
 * ---------------------------------------------------------------------------
 * UNE entrée par ressource, avec ses huit langues en alternatives
 * ---------------------------------------------------------------------------
 * Et non huit entrées séparées. C'est la forme que recommande la
 * documentation des moteurs pour un site multilingue : elle dit explicitement
 * que ces huit adresses sont la MÊME page, ce qu'une liste plate laisserait
 * deviner. Elle divise accessoirement par huit le nombre d'entrées, ce qui
 * éloigne d'autant le plafond de cinquante mille.
 *
 * L'adresse principale est la française : c'est la langue par défaut, celle
 * que sert `x-default`.
 *
 * ---------------------------------------------------------------------------
 * Ce qui n'y figure pas, et pourquoi
 * ---------------------------------------------------------------------------
 * Les pages sans contenu rédigé — CGV, cookies, livraison — sont écartées par
 * `isPlaceholderPage`. Annoncer à un moteur une page qui affiche « contenu non
 * rédigé » est une invitation à la référencer telle quelle ; le jour où elles
 * seront écrites, les retirer de cette liste les fera entrer ici sans que
 * personne ait à y penser.
 *
 * Les pages en `noindex` — panier, tunnel, compte, favoris, connexion — n'y
 * sont pas davantage : un plan de site est une liste de ce qu'on VEUT voir
 * indexé, pas un inventaire des routes.
 */

/**
 * Une heure.
 *
 * Le plan se régénère à la demande, mais pas à chaque requête : une pièce
 * publiée est visible en une heure au plus, et un robot qui reviendrait
 * toutes les minutes ne relancerait pas quatre requêtes à chaque passage.
 */
export const revalidate = 3600

/** Compose les huit adresses d'une même ressource. */
function alternates(path: string): Record<string, string> {
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((locale) => [localeTags[locale], `${SITE.url}/${locale}${path}`]),
  )
  languages['x-default'] = `${SITE.url}/${defaultLocale}${path}`
  return languages
}

function entree(
  resource: SitemapResource,
  options: { changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number },
): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE.url}/${defaultLocale}${resource.path}`,
    lastModified: resource.lastModified,
    changeFrequency: options.changeFrequency,
    priority: options.priority,
    alternates: { languages: alternates(resource.path) },
  }
}

/**
 * Les pages d'ENTRÉE du site, celles dont le contenu bouge tous les jours.
 *
 * Les pages fixes restantes — mentions légales, à propos, contact — ne
 * changent pas d'un mois à l'autre : annoncer le contraire apprend au robot à
 * ne plus croire ce que le plan lui dit.
 */
const ENTREES = new Set(['', '/catalogue', '/femme', '/homme'])

/**
 * La priorité est RELATIVE aux autres pages du même site, jamais aux pages
 * d'un autre. Elle dit simplement, ici, dans quel ordre parcourir en cas de
 * budget d'exploration limité : l'accueil, puis les deux univers, puis le
 * catalogue, puis le reste.
 */
const PRIORITES: Record<string, number> = {
  '': 1,
  '/femme': 0.9,
  '/homme': 0.9,
  '/catalogue': 0.9,
  '/marques': 0.6,
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const maintenant = new Date()

  const [articles, categories, marques] = await Promise.all([
    listSitemapArticles(),
    listSitemapCategories(),
    listSitemapBrands(),
  ])

  /*
    Les chemins fixes.

    `lastModified` vaut l'instant de génération : leur contenu ne vient pas de
    la base, donc aucune date ne le décrit. Mettre une date arbitraire — la
    date de mise en ligne, par exemple — serait une information fausse, et un
    moteur qui la croit cesse de revenir.
  */
  const fixes: SitemapResource[] = [
    { path: '', lastModified: maintenant },
    { path: '/catalogue', lastModified: maintenant },
    // Les deux univers. Ce sont, avec l'accueil, les pages d'entrée du site :
    // elles portent un intitulé que les gens tapent réellement dans un moteur,
    // là où « catalogue » n'est le mot de personne.
    { path: '/femme', lastModified: maintenant },
    { path: '/homme', lastModified: maintenant },
    { path: '/marques', lastModified: maintenant },
    ...PAGE_SLUGS.filter((slug) => !isPlaceholderPage(slug)).map((slug) => ({
      path: `/pages/${slug}`,
      lastModified: maintenant,
    })),
  ]

  return [
    ...fixes.map((resource) =>
      entree(resource, {
        changeFrequency: ENTREES.has(resource.path) ? 'daily' : 'monthly',
        priority: PRIORITES[resource.path] ?? 0.4,
      }),
    ),
    ...categories.map((resource) =>
      entree(resource, { changeFrequency: 'daily', priority: 0.8 }),
    ),
    ...marques.map((resource) =>
      entree(resource, { changeFrequency: 'daily', priority: 0.7 }),
    ),
    // Les fiches en dernier, et c'est le gros du fichier. `weekly` plutôt que
    // `daily` : une pièce ne change qu'à sa baisse de prix ou à sa vente.
    ...articles.map((resource) =>
      entree(resource, { changeFrequency: 'weekly', priority: 0.6 }),
    ),
  ]
}
