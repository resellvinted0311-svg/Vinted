import * as React from 'react'
import { cn } from '@/lib/utils/cn'

export interface StampProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Retire l'inclinaison, pour un alignement en colonne de tableau. */
  straight?: boolean
}

/**
 * Tampon de régie.
 *
 * Réservé aux FAITS de stock : « exemplaire unique », « vendu », « réservé ».
 * Jamais à un argument commercial — un tampon rouge incliné qui annoncerait
 * « dernière chance » fabriquerait de l'urgence, ce que le brief interdit et
 * ce que la loi encadre. Si l'information n'est pas vérifiable en base, elle
 * n'a rien à faire ici.
 */
export function Stamp({ className, straight = false, ...props }: StampProps) {
  return (
    <span
      className={cn('stamp-mark', straight && 'rotate-0', className)}
      {...props}
    />
  )
}
