import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Wordmark } from './wordmark'
import { LocaleSwitcher } from './locale-switcher'
import { AccountNav } from './account-nav'
import { SearchBox } from './search-box'

/**
 * En-tête.
 *
 * Entièrement statique, à l'exception de <AccountNav /> qui résout la session
 * côté client : c'est ce qui permet aux pages publiques de rester prérendues.
 */
export async function SiteHeader() {
  const t = await getTranslations('nav')

  const links = [
    { href: '/catalogue', label: t('catalogue') },
    { href: '/marques', label: t('brands') },
    { href: '/pages/a-propos', label: t('about') },
  ] as const

  return (
    <header className="border-b border-sand bg-paper">
      <div className="mx-auto flex max-w-[80rem] flex-wrap items-end justify-between gap-4 px-4 py-4 sm:px-6">
        <Wordmark />

        <nav
          aria-label={t('categories')}
          className="order-3 flex w-full gap-5 border-t border-sand pt-3 sm:order-none sm:w-auto sm:border-0 sm:pt-0"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-base text-muted transition-colors duration-150 ease-out hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <SearchBox className="order-4 w-full sm:order-none sm:w-64" />

        <div className="flex items-center gap-3">
          <LocaleSwitcher />

          <Link
            href="/favoris"
            className="text-base text-muted transition-colors duration-150 ease-out hover:text-ink"
          >
            {t('favorites')}
          </Link>

          <Link
            href="/panier"
            className="text-base text-muted transition-colors duration-150 ease-out hover:text-ink"
          >
            {t('cart')}
          </Link>

          <AccountNav />
        </div>
      </div>
    </header>
  )
}
