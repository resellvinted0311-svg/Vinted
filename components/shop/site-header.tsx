import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Wordmark } from './wordmark'
import { AccountNav } from './account-nav'
import { CartCountBadge } from './cart-count-badge'

/**
 * La barre de navigation, flottante.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle porte, et ce qu'elle ne porte plus
 * ---------------------------------------------------------------------------
 * Cinq chemins : les trois entrées du site, les favoris, le panier, plus
 * l'entrée du compte. Rien d'autre.
 *
 * En sont sortis, dans l'ordre : la recherche, partie dans la vue catalogue
 * auprès des résultats qu'elle filtre ; le sélecteur de langue, descendu dans
 * le colophon, puisqu'on le règle une fois en arrivant et que la langue vit
 * ensuite dans l'adresse ; le prénom, le lien vers la régie et la
 * déconnexion, remontés dans l'espace compte, qui est l'écran prévu pour eux.
 *
 * La règle qui a servi à trancher : une barre de navigation porte des CHEMINS,
 * pas des commandes ni un état. Un prénom et un bouton de déconnexion affichés
 * en permanence en faisaient un tableau de bord.
 *
 * ---------------------------------------------------------------------------
 * Composée en romain, pas en petites capitales de régie
 * ---------------------------------------------------------------------------
 * Les entrées étaient en chasse fixe, capitales, interlettrage large — le
 * traitement que la charte réserve aux DONNÉES : une référence, un poids, un
 * intitulé de colonne. Appliqué à « Marques » et « Panier », il donnait le ton
 * d'un terminal plutôt que d'une boutique. Les libellés reviennent au romain
 * du texte courant ; l'étiquette de régie reste là où il y a une donnée.
 *
 * ---------------------------------------------------------------------------
 * Flottante, et pourquoi `sticky` plutôt que `fixed`
 * ---------------------------------------------------------------------------
 * `position: fixed` sort la barre du flux : il faut alors réserver sa hauteur
 * en haut du contenu, à la main, et cette réserve se désaccorde à chaque
 * changement de gabarit. `sticky` garde la barre dans le flux : elle occupe sa
 * vraie hauteur, la réserve est automatique, et rien ne passe sous elle au
 * chargement.
 *
 * Le décollement des bords vient du rembourrage de l'élément collant
 * lui-même : c'est lui qui reste visible une fois la barre accrochée en haut.
 *
 * Entièrement statique, à l'exception du compte et du compteur de panier : ce
 * sont eux qui lisent la session, et les garder côté client est ce qui permet
 * aux pages publiques de rester prérendues.
 */
export async function SiteHeader() {
  const t = await getTranslations('nav')

  /*
    Trois chemins, et il a failli y en avoir quatre.

    « Contact » avait sa place ici — on écrit avant d'acheter, dans une
    boutique où chaque pièce est unique. Il a été retiré parce que la cible
    N'EXISTE PAS : `/contact` n'est routé nulle part. Le colophon pointe
    dessus depuis le début, et c'est un lien mort, en production, depuis le
    début aussi.

    Le défaut s'est révélé de façon détournée, et c'est ce qui le rend
    intéressant : le lien ajouté ici a déclenché le préchargement que Next
    lance au survol d'un `Link`, la réponse d'un chemin sans route ne s'est
    jamais terminée, et un test du tunnel d'achat — qui attend le corps de
    toutes les réponses — s'est mis à expirer. Un lien mort ne fait rien
    échouer par lui-même : il faut qu'un test tire sur le fil.

    Signalé, pas rafistolé : une page de contact demande une adresse, un
    formulaire, une politique de conservation. Ce n'est pas une ligne de
    navigation.
  */
  const links = [
    { href: '/catalogue', label: t('catalogue') },
    { href: '/marques', label: t('brands') },
    { href: '/pages/a-propos', label: t('about') },
  ] as const

  const services = [
    { href: '/favoris', label: t('favorites'), badge: false },
    { href: '/panier', label: t('cart'), badge: true },
  ] as const

  const lien =
    'whitespace-nowrap text-base text-muted transition-colors duration-150 ease-out hover:text-ink'

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="nav-bar nav-float mx-auto max-w-[80rem] px-4 py-3 sm:px-6">
        {/*
          La signature sans sa baseline : une barre de navigation porte le nom
          de la boutique, pas son argument. La baseline reste là où elle
          informe — en tête de vitrine et dans le colophon.
        */}
        <Wordmark size="sm" tagline={false} className="nav-bar__mark" />

        {/*
          Le point de repère annonce ce qu'il contient, et pas autre chose.

          Il s'intitulait « Catégories » — dans les huit langues — sur un menu
          qui n'en offre AUCUNE : ni robes, ni vestes, ni chaussures, seulement
          le catalogue, les marques et la page à propos. Pour qui navigue au
          lecteur d'écran, la liste des points de repère annonçait donc une
          entrée qui n'existe pas, et c'est un défaut RGAA opposable — pas une
          maladresse de rédaction.

          Il vient de la refonte de cette barre : l'ancien en-tête portait une
          vraie navigation par catégorie sous ce libellé, la nouvelle ne l'a pas
          reprise et l'intitulé est resté. Exposer réellement les catégories ici
          est une décision de composition qui reste à prendre ; annoncer juste
          ce qu'on offre n'en est pas une.
        */}
        <nav
          aria-label={t('mainNav')}
          className="nav-bar__nav flex flex-wrap gap-x-6 gap-y-1"
        >
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={lien}>
              {link.label}
            </Link>
          ))}
        </nav>

        {/*
          `flex-wrap` : « Mon compte » se dit plus long en portugais qu'en
          français, et les huit langues ne tiennent pas toutes dans la même
          largeur. Sans repli, le groupe passait sous le bord arrondi de la
          barre au lieu de descendre d'une ligne.
        */}
        <div className="nav-bar__tools flex flex-wrap items-center justify-end gap-x-5 gap-y-1 sm:gap-x-6">
          {services.map((service) => (
            <Link
              key={service.href}
              href={service.href}
              className={`${lien} inline-flex items-center gap-1.5`}
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
