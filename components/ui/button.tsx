import * as React from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils/cn'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  // Vert profond désaturé — action principale.
  primary:
    'bg-moss text-ink-inverse border border-moss hover:bg-moss-hover hover:border-moss-hover',
  // Terracotta — actions secondaires et soldes.
  secondary:
    'bg-clay text-ink-inverse border border-clay hover:bg-clay-hover hover:border-clay-hover',
  // Bordure 1px plutôt qu'une ombre portée.
  outline:
    'bg-transparent text-ink border border-sand-strong hover:bg-paper-raised',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-paper-raised',
  danger:
    'bg-transparent text-danger border border-danger hover:bg-danger hover:text-ink-inverse',
}

const sizes: Record<Size, string> = {
  // min-h garantit la cible tactile de 44px demandée par le brief.
  sm: 'min-h-[44px] px-3 text-xs gap-1.5',
  md: 'min-h-[44px] px-4 text-base gap-2',
  lg: 'min-h-[52px] px-6 text-lg gap-2',
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Rend l'enfant direct à la place du <button> (lien stylé en bouton). */
  asChild?: boolean
  fullWidth?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = 'primary',
      size = 'md',
      asChild = false,
      fullWidth = false,
      type,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot.Root : 'button'

    return (
      <Comp
        ref={ref}
        // Un <button> sans type dans un <form> soumet le formulaire par
        // accident. On force `button` sauf indication contraire.
        {...(asChild ? {} : { type: type ?? 'button' })}
        className={cn(
          'inline-flex items-center justify-center rounded-input font-medium',
          'transition-colors duration-150 ease-out',
          'disabled:pointer-events-none disabled:opacity-50',
          variants[variant],
          sizes[size],
          fullWidth && 'w-full',
          className,
        )}
        {...props}
      />
    )
  },
)
