import * as React from 'react'
import { cn } from '@/lib/utils/cn'

type Tone = 'neutral' | 'moss' | 'clay' | 'success' | 'warning' | 'danger' | 'sold'

const tones: Record<Tone, string> = {
  neutral: 'border-sand-strong text-muted',
  moss: 'border-moss text-moss',
  clay: 'border-clay text-clay',
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
 * Étiquette d'état. Bordure 1px, jamais de fond plein criard : elle informe,
 * elle ne crée pas d'urgence.
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-input border px-2 py-0.5',
        'text-xs font-medium leading-5',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
