import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Wordmark } from './wordmark'
import { LocaleSwitcher } from './locale-switcher'
import { AccountNav } from './account-nav'
import { CartCountBadge } from './cart-count-badge'

/**
 * La barre de navigation, flottante.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle porte, et ce qu'elle ne porte plus
 * ---------------------------------------------------------------------------
 * Les informations principales, et elles seules : la signature, les trois
 * entrées du site, les favoris, le panier, le compte et la langue. La
 * recherche en est SORTIE — elle vit désormais dans la vue catalogue, à côté
 * des résultats qu'elle filtre. Un champ de recherche posé dans l'en-tête
 * s'affiche sur la page d'accueil, sur une fiche article, sur le tunnel de
 * paiement : partout où l'on ne cherche pas.
 *
 * ---------------------------------------------------------------------------
 * Flottante, et pourquoi `sticky` plutôt que `fixed`
 * ---------------------------------------------------------------------------
 * `position: fixed` sort la barre du flux : il faut alors réserver sa hauteur
 * en haut du contenu, à la main, et cette réserve se désaccorde à chaque
 * changement de gabarit — deux registres sur téléphone, un seul sur bureau.
 * `sticky` garde la barre dans le flux : elle occupe sa vraie hauteur, la
 * réserve est automatique, et rien ne passe sous elle au chargement.
 *
 * Le décollement des bords vient du rembourrage de l'élément collant
 * lui-même : c'est lui qui reste visible une fois la barre accrochée en haut.
 *
 * Entièrement statique, à l'exception du compte, du compteur de panier et du
 * sélecteur de langue : ce sont eux qui lisent la session ou l'URL, et les
 * garder côté client est ce qui permet aux pages publiques de rester
 * prérendues.
 */
export async function SiteHeader() {
  const t = await getTranslations('nav')

  const links = [
    { href: '/catalogue', label: t('catalogue') },
    { href: '/marques', label: t('brands') },
    { href: '/pages/a-propos', label: t('about') },
  ] as const

  const services = [
    { href: '/favoris', label: t('favorites'), badge: false },
    { href: '/panier', label: t('cart'), badge: true },
  ] as const

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="nav-bar nav-float mx-auto max-w-[80rem] px-4 py-3 sm:px-5">
        {/*
          La signature sans sa baseline : une barre de navigation porte le nom
          de la boutique, pas son argument. La baseline reste là où elle
          informe — en tête de vitrine et dans le colophon.
        */}
        <Wordmark size="sm" tagline={false} className="nav-bar__mark" />

        <nav
          aria-label={t('categories')}
          className="nav-bar__nav flex flex-wrap gap-x-5 gap-y-1 sm:gap-x-6"
        >
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

        {/*
          Le sélecteur de langue a sa propre zone de grille : il termine la
          ligne de titre sur grand écran et la ligne de navigation sur petit,
          sans être rendu deux fois. Voir `.nav-bar` dans globals.css.
        */}
        <div className="nav-bar__lang">
          <LocaleSwitcher className="w-[6.75rem]" />
        </div>

        {/*
          `flex-wrap` : « Se connecter » se dit plus long en portugais qu'en
          français, et les huit langues ne tiennent pas toutes dans la même
          largeur. Sans repli, le groupe passait sous le bord arrondi de la
          barre au lieu de descendre d'une ligne.
        */}
        <div className="nav-bar__tools flex flex-wrap items-center justify-end gap-x-4 gap-y-1 sm:gap-x-5">
          {services.map((service) => (
            <Link
              key={service.href}
              href={service.href}
              className="label-reg inline-flex items-center gap-1.5 whitespace-nowrap text-muted transition-colors duration-150 ease-out hover:text-ink"
            >
              {service.label}
              {/*
                Le compteur se charge après l'hydratation, comme l'état de
                session : le lire ici rendrait dynamiques toutes les pages que
                cette barre traverse, y compris celles qui portent le
                référencement.
              */}
              {service.badge ? <CartCountBadge /> : null}
            </Link>
          ))}

          <AccountNav />
        </div>
      </div>
    </header>
  )
}
