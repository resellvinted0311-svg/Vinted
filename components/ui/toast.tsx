'use client'

import * as React from 'react'
import { Toast as RadixToast } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'

type ToastTone = 'neutral' | 'success' | 'warning' | 'danger'

interface ToastItem {
  id: string
  title: string
  description?: string
  tone: ToastTone
  /** Action optionnelle, ex. « Annuler » ou « Voir le panier ». */
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  toast: (input: Omit<ToastItem, 'id'> & { id?: string }) => void
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast doit être appelé dans <ToastProvider>.')
  return ctx
}

const tones: Record<ToastTone, string> = {
  neutral: 'border-sand-strong',
  success: 'border-success',
  warning: 'border-warning',
  danger: 'border-danger',
}

/**
 * Notifications transitoires.
 *
 * Utilisées pour expliquer un changement qui n'a pas été déclenché par la
 * personne — un article de son panier qui vient d'être vendu, une offre
 * refusée. Jamais pour créer de l'urgence commerciale.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common')
  const [items, setItems] = React.useState<ToastItem[]>([])

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = React.useCallback<ToastContextValue['toast']>((input) => {
    const id = input.id ?? crypto.randomUUID()
    setItems((prev) => {
      // Un même identifiant ne s'empile pas : il remplace.
      const without = prev.filter((item) => item.id !== id)
      return [...without, { ...input, id }]
    })
  }, [])

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="right" duration={6000}>
        {children}

        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            open
            onOpenChange={(open) => {
              if (!open) dismiss(item.id)
            }}
            className={cn(
              'flex items-start gap-3 rounded-card border-[1.5px] bg-surface p-3',
              'shadow-[4px_4px_0_var(--rule)]',
              'data-[state=closed]:opacity-0',
              'transition-opacity duration-200 ease-out',
              tones[item.tone],
            )}
          >
            <div className="flex-1">
              <RadixToast.Title className="text-base font-medium text-ink">
                {item.title}
              </RadixToast.Title>
              {item.description ? (
                <RadixToast.Description className="mt-0.5 text-xs text-muted">
                  {item.description}
                </RadixToast.Description>
              ) : null}
            </div>

            {item.action ? (
              <RadixToast.Action
                altText={item.action.label}
                onClick={item.action.onClick}
                className="label-reg shrink-0 rounded-input border-[1.5px] border-rule px-2 py-1 text-ink hover:bg-paper-raised"
              >
                {item.action.label}
              </RadixToast.Action>
            ) : null}

            <RadixToast.Close
              aria-label={t('close')}
              className="shrink-0 text-muted hover:text-ink"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </RadixToast.Close>
          </RadixToast.Root>
        ))}

        <RadixToast.Viewport
          className={cn(
            'fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4',
            'outline-none',
          )}
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}
