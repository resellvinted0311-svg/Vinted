import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Équivalents localisés de Link, useRouter, redirect…
 *
 * Toujours importer depuis ce module plutôt que depuis `next/link` ou
 * `next/navigation` : sinon la langue courante saute à la navigation.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
