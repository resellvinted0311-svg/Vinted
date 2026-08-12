'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'
import { useFieldControlProps } from './field'

const base = cn(
  'w-full min-h-[44px] rounded-input bg-surface px-3 py-2',
  'border border-sand-strong text-ink placeholder:text-muted',
  'transition-colors duration-150 ease-out',
  'hover:border-ink/30',
  'disabled:cursor-not-allowed disabled:bg-paper-raised disabled:opacity-60',
  'aria-[invalid=true]:border-danger',
)

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** Champ texte. À utiliser dans <Field> pour hériter du label et de l'erreur. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, ...props }, ref) {
    const fieldProps = useFieldControlProps()
    return (
      <input
        ref={ref}
        {...fieldProps}
        className={cn(base, className)}
        {...props}
      />
    )
  },
)

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    const fieldProps = useFieldControlProps()
    return (
      <textarea
        ref={ref}
        rows={rows}
        {...fieldProps}
        className={cn(base, 'resize-y leading-relaxed', className)}
        {...props}
      />
    )
  },
)

/**
 * Variante hors <Field>, pour les cas où le libellé est porté autrement
 * (barre de recherche avec label masqué visuellement, par exemple).
 */
export const BareInput = React.forwardRef<HTMLInputElement, InputProps>(
  function BareInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(base, className)} {...props} />
  },
)
