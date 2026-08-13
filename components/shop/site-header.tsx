import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Wordmark } from './wordmark'
import { LocaleSwitcher } from './locale-switcher'
import { AccountNav } from './account-nav'
import { SearchBox } from './search-box'

/**
 * En-tête.
 *
 * Deux registres superposés : la signature et les entrées de catalogue en
 * haut, la barre de service en dessous, séparée par un filet plein. Le filet
 * est la respiration de la charte — c'est lui qui donne l'impression d'un
 * document réglé plutôt que d'une barre de navigation.
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

  const services = [
    { href: '/favoris', label: t('favorites') },
    { href: '/panier', label: t('cart') },
  ] as const

  return (
    <header className="ruled-b bg-paper">
      <div className="mx-auto max-w-[80rem] px-4 sm:px-6">
        {/*
          Ligne de titre. Recherche, langue et compte y sont posés une seule
          fois : les dupliquer pour une variante mobile créerait deux champs de
          recherche portant le même intitulé, donc deux combobox annoncés aux
          lecteurs d'écran pour une seule fonction.
        */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 py-4">
          <Wordmark />

          <div className="flex w-full items-center gap-3 sm:w-auto sm:flex-1 sm:justify-end">
            <SearchBox className="min-w-0 flex-1 sm:max-w-xs" />
            <LocaleSwitcher />
            <AccountNav />
          </div>
        </div>

        {/*
          Barre de service, sous un filet fin. Séparer les entrées de catalogue
          de la ligne de titre évite l'encombrement qui faisait passer
          « Se connecter » à la ligne, et donne au bandeau la structure d'une
          manchette imprimée.
        */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-sand py-2.5">
          <nav aria-label={t('categories')} className="flex flex-wrap gap-x-6 gap-y-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="label-reg whitespace-nowrap text-muted transition-colors duration-150 ease-out hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-5">
            {services.map((service) => (
              <Link
                key={service.href}
                href={service.href}
                className="label-reg whitespace-nowrap text-muted transition-colors duration-150 ease-out hover:text-ink"
              >
                {service.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}
