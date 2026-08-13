import * as React from 'react'
import { cn } from '@/lib/utils/cn'

type Tone =
  | 'neutral'
  | 'stamp'
  | 'mark'
  | 'success'
  | 'warning'
  | 'danger'
  | 'sold'

const tones: Record<Tone, string> = {
  neutral: 'border-sand-strong text-muted',
  stamp: 'border-stamp text-stamp',
  mark: 'border-mark text-mark',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
  // Un article vendu reste visible : il est marqué, pas caché.
  sold: 'border-sand-strong bg-paper-raised text-muted',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

/**
 * Étiquette d'état. Contour net, jamais de fond plein criard : elle informe,
 * elle ne crée pas d'urgence. Composée en chasse fixe, comme toute donnée de
 * régie.
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'label-reg inline-flex items-center gap-1 rounded-input border',
        'px-2 py-1',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
