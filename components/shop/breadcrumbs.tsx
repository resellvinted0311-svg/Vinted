import { Link } from '@/lib/i18n/navigation'
import { SITE } from '@/lib/config/site'

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
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
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
        // Contenu entièrement produit par le serveur à partir de données
        // internes : aucune entrée utilisateur n'y transite.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  )
}
