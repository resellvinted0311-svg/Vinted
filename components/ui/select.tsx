'use client'

import * as React from 'react'
import { Select as RadixSelect } from 'radix-ui'
import { cn } from '@/lib/utils/cn'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  options: readonly SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  name?: string
  /** Libellé accessible quand aucun <label> visible n'est associé. */
  ariaLabel?: string
  className?: string
  id?: string
}

/**
 * Liste déroulante bâtie sur Radix Select : navigation clavier, gestion du
 * focus et annonces ARIA fournies par la primitive, apparence entièrement
 * réécrite (aucun style Radix conservé).
 */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Sélectionner',
  disabled = false,
  name,
  ariaLabel,
  className,
  id,
}: SelectProps) {
  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex w-full min-h-[44px] items-center justify-between gap-2',
          'rounded-input border-[1.5px] border-rule bg-surface px-3 py-2',
          'text-left text-ink transition-colors duration-150 ease-out',
          'hover:bg-paper-raised',
          'data-[placeholder]:text-muted',
          'disabled:cursor-not-allowed disabled:bg-paper-raised disabled:opacity-60',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon aria-hidden className="text-muted">
          <ChevronDown />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 max-h-[min(24rem,var(--radix-select-content-available-height))]',
            'w-[var(--radix-select-trigger-width)] overflow-hidden',
            // Le panneau flotte : le contour plein le détache du fond sans
            // recourir à une ombre floue, absente de cette charte.
            'rounded-card border-[1.5px] border-rule bg-surface',
            'shadow-[4px_4px_0_var(--rule)]',
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className={cn(
                  'flex min-h-[40px] cursor-pointer select-none items-center',
                  'rounded-input px-3 text-base text-ink outline-none',
                  'data-[highlighted]:bg-paper-raised',
                  'data-[state=checked]:font-medium',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                )}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

function ChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 5.25 3.5 3.5 3.5-3.5" />
    </svg>
  )
}
