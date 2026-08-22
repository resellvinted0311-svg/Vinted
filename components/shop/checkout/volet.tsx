import * as React from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Un volet du bon de commande.
 *
 * ---------------------------------------------------------------------------
 * Un repère, pas une jauge d'avancement
 * ---------------------------------------------------------------------------
 * L'ordinal sert à se retrouver dans une page longue et à se référer à une
 * section — « le point 03 » — pas à mesurer ce qu'il reste à faire. Aucun état
 * « rempli » n'en est dérivé : un volet qui se coche tout seul transforme un
 * formulaire en parcours à étapes, alors que tout est ici, visible en même
 * temps, et modifiable dans n'importe quel ordre.
 *
 * C'est aussi ce qui évite la question insoluble du « à moitié rempli » :
 * une adresse dont il manque le code postal n'est ni faite ni à faire, et
 * n'importe quelle pastille verte ou orange posée là mentirait.
 */
export function Volet({
  ordinal,
  title,
  hint,
  children,
  className,
}: {
  /** Rang affiché, sur deux chiffres : 01, 02, 03, 04. */
  ordinal: string
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const headingId = `volet-${ordinal}`

  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-card ruled bg-surface p-5', className)}
    >
      <div className="flex items-baseline gap-3">
        <span data-numeric aria-hidden className="data text-xs text-muted">
          {ordinal}
        </span>
        <h2 id={headingId} className="label-reg text-ink">
          {title}
        </h2>
      </div>

      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}

      <div className="mt-4">{children}</div>
    </section>
  )
}
