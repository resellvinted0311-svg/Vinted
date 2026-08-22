import * as React from 'react'
import { cn } from '@/lib/utils/cn'

type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'success'

/**
 * Encart de page.
 *
 * Le motif — carte réglée sur papier surélevé — se répétait dans chaque page
 * de la boutique. Le sortir ici sert surtout à une chose : que le `role` soit
 * un choix explicite plutôt qu'un oubli.
 *
 * `role="status"` annonce poliment, sans interrompre : un résultat, une
 * confirmation, un état d'attente. `role="alert"` interrompt : une erreur qui
 * empêche de continuer. Un encart sans `role` n'est pas annoncé du tout — ce
 * qui est le bon choix pour un encadré purement informatif, et le mauvais pour
 * un message qui apparaît en réponse à un geste.
 */
const tones: Record<Tone, string> = {
  neutral: 'border-sand-strong',
  info: 'border-rule',
  warning: 'border-warning',
  danger: 'border-danger',
  success: 'border-success',
}

export interface NoticeProps
  // `title` est réservé aux attributs HTML pour l'infobulle native, une chaîne.
  // Ici il désigne l'intitulé rendu de l'encart, qui peut porter du balisage.
  //
  // `ComponentPropsWithRef` et non `HTMLAttributes` : depuis React 19, `ref`
  // est une propriété ordinaire des composants fonction. L'encart d'erreur du
  // tunnel a besoin d'y placer le focus, et `forwardRef` n'a pas sa place dans
  // un composant qui doit aussi se rendre côté serveur.
  extends Omit<React.ComponentPropsWithRef<'div'>, 'title'> {
  tone?: Tone
  title?: React.ReactNode
}

export function Notice({
  tone = 'neutral',
  title,
  children,
  className,
  ...props
}: NoticeProps) {
  return (
    <div
      className={cn(
        'rounded-card border-[1.5px] bg-paper-raised p-4',
        tones[tone],
        className,
      )}
      {...props}
    >
      {title ? (
        <p className="label-reg text-ink">{title}</p>
      ) : null}
      {children ? (
        <div className={cn('text-sm text-muted', title && 'mt-1.5')}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
