'use client'

import * as React from 'react'
import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui'
import { cn } from '@/lib/utils/cn'

export const DialogRoot = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close

export interface DialogProps {
  /** Titre obligatoire : Radix exige un intitulé accessible. */
  title: string
  /** Masque le titre visuellement tout en le gardant pour les lecteurs d'écran. */
  hideTitle?: boolean
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function DialogContent({
  title,
  hideTitle = false,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-ink/40',
          'data-[state=open]:animate-in data-[state=open]:fade-in',
        )}
      />
      <RadixDialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg',
          '-translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100vh-2rem)] overflow-y-auto',
          'rounded-card ruled bg-surface p-5 shadow-[6px_6px_0_var(--rule)]',
          className,
        )}
      >
        {hideTitle ? (
          <VisuallyHidden.Root>
            <RadixDialog.Title>{title}</RadixDialog.Title>
          </VisuallyHidden.Root>
        ) : (
          <RadixDialog.Title className="text-lg">{title}</RadixDialog.Title>
        )}

        {description ? (
          <RadixDialog.Description className="mt-1 text-xs text-muted">
            {description}
          </RadixDialog.Description>
        ) : null}

        <div className={cn(hideTitle && !description ? '' : 'mt-4')}>
          {children}
        </div>

        {footer ? (
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}

        <RadixDialog.Close
          aria-label="Fermer"
          className={cn(
            'absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center',
            'rounded-input text-muted transition-colors duration-150 ease-out',
            'hover:bg-paper-raised hover:text-ink',
          )}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
