import * as React from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils/cn'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

/**
 * Le bouton de la charte « Registre » : angle vif, contour net, et au survol
 * un décalage de deux pixels qui découvre une ombre pleine — deux cartons
 * superposés, pas une lueur. Le geste vit dans `.lift` (globals.css).
 */
const variants: Record<Variant, string> = {
  // Encre de régie — action principale.
  primary: 'bg-stamp text-ink-inverse border-stamp hover:bg-stamp-hover',
  // Tampon — ce qui marque une pièce : remise, mise en avant.
  secondary: 'bg-mark text-ink-inverse border-mark hover:bg-mark-hover',
  // Contour plein encre : l'objet est délimité, pas rempli.
  outline: 'bg-transparent text-ink border-rule hover:bg-paper-raised',
  ghost:
    'bg-transparent text-ink border-transparent hover:border-rule hover:bg-paper-raised',
  danger:
    'bg-transparent text-danger border-danger hover:bg-danger hover:text-ink-inverse',
}

const sizes: Record<Size, string> = {
  // min-h garantit la cible tactile de 44px demandée par le brief.
  sm: 'min-h-[44px] px-3.5 text-xs gap-1.5',
  md: 'min-h-[44px] px-5 text-base gap-2',
  lg: 'min-h-[52px] px-7 text-base gap-2',
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
          'lift inline-flex items-center justify-center rounded-input',
          'border-[1.5px] font-medium',
          // Désactivé : traitement neutre explicite, pas une opacité posée sur
          // la couleur d'accent. Une encre de régie à 45 % vire au lavande et
          // se lit comme un bouton cassé plutôt que comme une action
          // indisponible.
          'disabled:pointer-events-none disabled:border-sand-strong',
          'disabled:bg-sand disabled:text-muted disabled:shadow-none',
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
