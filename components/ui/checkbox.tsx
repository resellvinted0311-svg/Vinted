'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string | undefined
}

/**
 * Case à cocher native.
 *
 * Native, et non un composant Radix : l'action serveur lit
 * `formData.get('acceptsTerms') === 'on'`, ce que seule une vraie case
 * transmet. Un composant stylé exigerait un champ caché tenu en parallèle, et
 * c'est exactement le genre de doublon qui finit désynchronisé — ici, sur
 * l'acceptation des conditions de vente, c'est-à-dire sur la seule preuve que
 * l'on garde d'un consentement.
 *
 * Elle ne vit pas dans `<Field>` : `Field` relie un `<label>` unique à un
 * contrôle unique par `htmlFor`, alors qu'une case porte son libellé à sa
 * droite et se coche en cliquant dessus. Le libellé enveloppe donc l'entrée.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, hint, error, className, ...props }, ref) {
    const id = React.useId()
    const errorId = `${id}-error`
    const hintId = `${id}-hint`
    const describedBy = [hint ? hintId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ')

    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label
          htmlFor={id}
          className="flex items-start gap-2.5 text-sm text-ink"
        >
          <input
            ref={ref}
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 accent-[var(--stamp)]',
              'aria-[invalid=true]:outline aria-[invalid=true]:outline-1',
              'aria-[invalid=true]:outline-[var(--danger)]',
            )}
            {...props}
          />
          <span>{label}</span>
        </label>

        {hint ? (
          <p id={hintId} className="pl-[1.625rem] text-xs text-muted">
            {hint}
          </p>
        ) : null}

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="pl-[1.625rem] text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
      </div>
    )
  },
)
