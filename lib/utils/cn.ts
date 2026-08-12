import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Compose des classes Tailwind en laissant la dernière l'emporter. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
