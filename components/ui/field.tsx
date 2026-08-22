'use client'

import * as React from 'react'
import { Label } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'

interface FieldContextValue {
  id: string
  errorId: string
  hintId: string
  hasError: boolean
  hasHint: boolean
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

function useField(): FieldContextValue {
  const ctx = React.useContext(FieldContext)
  if (!ctx) {
    throw new Error('Les sous-composants de Field doivent vivre dans <Field>.')
  }
  return ctx
}

export interface FieldProps {
  children: React.ReactNode
  /** Message d'erreur. Sa présence bascule le champ en état invalide. */
  error?: string | undefined
  /** Aide contextuelle affichée sous le champ. */
  hint?: string | undefined
  className?: string
}

/**
 * Enveloppe de champ de formulaire.
 *
 * Câble un vrai <label> (jamais un placeholder tenant lieu d'étiquette), relie
 * l'aide et l'erreur au champ via aria-describedby, et annonce l'erreur aux
 * lecteurs d'écran.
 */
export function Field({ children, error, hint, className }: FieldProps) {
  const id = React.useId()
  const value = React.useMemo<FieldContextValue>(
    () => ({
      id,
      errorId: `${id}-error`,
      hintId: `${id}-hint`,
      hasError: Boolean(error),
      hasHint: Boolean(hint),
    }),
    [id, error, hint],
  )

  return (
    <FieldContext.Provider value={value}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {children}
        {hint ? (
          <p id={value.hintId} className="text-xs text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p
            id={value.errorId}
            role="alert"
            aria-live="polite"
            className="text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

export function FieldLabel({
  children,
  className,
  optional = false,
}: {
  children: React.ReactNode
  className?: string
  optional?: boolean
}) {
  const { id } = useField()
  // Traduit, et non écrit en français dans le composant : cette mention
  // apparaît dans le tunnel de commande, que huit langues traversent.
  const t = useTranslations('common')

  return (
    <Label.Root
      htmlFor={id}
      className={cn('label-reg text-ink', className)}
    >
      {children}
      {optional ? (
        <span className="ml-1 normal-case tracking-normal text-muted">
          {t('optional')}
        </span>
      ) : null}
    </Label.Root>
  )
}

/** Attributs d'accessibilité à étaler sur le contrôle du champ. */
export function useFieldControlProps() {
  const { id, errorId, hintId, hasError, hasHint } = useField()
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null]
    .filter(Boolean)
    .join(' ')

  return {
    id,
    'aria-invalid': hasError || undefined,
    'aria-describedby': describedBy || undefined,
  } as const
}
