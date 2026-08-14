import { Link } from '@/lib/i18n/navigation'
import { SITE } from '@/lib/config/site'
import { serializeJsonLd } from '@/lib/utils/json-ld'

export interface Crumb {
  /** `null` pour l'élément courant, qui n'est pas un lien. */
  href: string | null
  label: string
}

/**
 * Fil d'Ariane.
 *
 * Émet aussi le JSON-LD `BreadcrumbList` correspondant : les deux sont
 * produits au même endroit pour ne pas diverger.
 */
export function Breadcrumbs({
  items,
  locale,
}: {
  items: Crumb[]
  locale?: string
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(item.href
        ? { item: `${SITE.url}/${locale ?? 'fr'}${item.href}` }
        : {}),
    })),
  }

  return (
    <>
      <nav aria-label="Fil d'Ariane">
        <ol className="label-reg flex flex-wrap items-center gap-1.5 text-muted">
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden className="text-sand-strong">
                  /
                </span>
              ) : null}

              {item.href ? (
                <Link
                  href={item.href}
                  className="transition-colors duration-150 ease-out hover:text-ink"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-ink">
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <script
        type="application/ld+json"
        // Sérialisé par serializeJsonLd : les libellés viennent de la base
        // (titres traduits, noms de catégorie) et ne sont donc PAS des données
        // internes de confiance. `JSON.stringify` seul laissait passer une
        // fermeture de balise script.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
    </>
  )
}
