import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Wordmark } from './wordmark'
import { AccountNav } from './account-nav'
import { CartCountBadge } from './cart-count-badge'
import { FavoritesCountBadge } from './favorites-count-badge'
import { HeaderSearch } from './header-search'
import { Surpiqure } from './surpiqure'
import { IconeFavoris, IconePanier } from './icones'

/**
 * La barre de navigation.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle porte
 * ---------------------------------------------------------------------------
 * Le nom au bord gauche, quatre chemins, quatre outils au bord droit. Rien
 * d'autre.
 *
 * Les quatre chemins ont été choisis pour être QUATRE PORTES DISTINCTES, et
 * c'est la contrainte qui a décidé de leurs cibles :
 *
 *   Femmes      /femme      un univers
 *   Hommes      /homme      l'autre univers
 *   Nouveautés  /catalogue  le catalogue entier, trié du plus récent
 *   Découvrir   /marques    l'entrée par marque
 *
 * « Nouveautés » vise le catalogue NU, sans paramètre de tri, et ce n'est pas
 * un raccourci : `nouveautes` EST le tri par défaut, et `filtersToSearchParams`
 * n'écrit `tri=` que lorsqu'on s'en écarte. Poser `/catalogue?tri=nouveautes`
 * aurait donc fabriqué une seconde adresse pour exactement la même page —
 * deux entrées de cache, deux pages indexables, un contenu dupliqué. Le
 * projet a déjà payé cette erreur ailleurs, et son commentaire est resté.
 *
 * « Découvrir » vise l'index des marques, et ce choix règle un problème plutôt
 * que d'en créer un. En perdant l'entrée « Marques », `/marques` n'aurait plus
 * eu AUCUN lien entrant depuis le site : ni la barre, ni le colophon ne la
 * portaient. Une page indexable sans lien entrant s'effondre au référencement,
 * et c'est exactement le défaut qu'on a déjà corrigé sur les pages de rayon.
 * Elle garde donc une porte, sous un nom qui dit ce qu'on y fait.
 *
 * « Tout le catalogue » et « À propos » ne disparaissent pas non plus :
 * la première est devenue « Nouveautés », la seconde vit dans le colophon,
 * qui la porte depuis le début.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le nom touche le bord, et pourquoi la barre est plus haute
 * ---------------------------------------------------------------------------
 * La barre ne s'aligne plus sur la colonne de contenu de 80 rem. Elle occupe
 * toute la largeur, et son rembourrage est le seul écart entre la signature et
 * le bord de la fenêtre. Une barre qui s'arrête où le texte s'arrête se lit
 * comme un bloc de contenu ; une barre qui va d'un bord à l'autre se lit comme
 * le CADRE du site — et c'est ce qu'elle est.
 *
 * La hauteur suit : la signature passe au corps supérieur, le rembourrage
 * vertical double. Une barre haute donne de l'air aux quatre outils, qui sans
 * cela se serrent contre les chemins.
 *
 * ---------------------------------------------------------------------------
 * Statique, sauf trois éclats
 * ---------------------------------------------------------------------------
 * Tout est rendu sur le serveur, à l'exception de l'entrée « compte » et des
 * deux compteurs : eux seuls lisent la session. Les isoler est ce qui permet
 * aux pages publiques — accueil, catalogue, fiches — de rester prérendues,
 * donc rapides et indexables. Lire la session ici basculerait TOUT le site en
 * rendu dynamique.
 */
export async function SiteHeader() {
  const t = await getTranslations('nav')

  /*
    Quatre chemins, et pas un de plus.

    « Contact » a failli en être. Il a été retiré parce que sa cible n'existait
    pas — `/contact` n'est routé nulle part — et le défaut ne s'est révélé que
    de façon détournée : le préchargement que Next lance au survol d'un `Link`
    ne s'est jamais terminé, et un test du tunnel d'achat s'est mis à expirer.
    Un lien mort ne fait rien échouer par lui-même ; il faut qu'un test tire
    sur le fil. D'où la règle : chaque cible ci-dessous a été vérifiée comme
    route existante.
  */
  const chemins = [
    { href: '/femme', label: t('women') },
    { href: '/homme', label: t('men') },
    { href: '/catalogue', label: t('newIn') },
    { href: '/marques', label: t('discover') },
  ] as const

  const lien =
    'whitespace-nowrap text-base text-ink transition-colors duration-150 ease-out hover:text-stamp'

  /*
    Le gabarit commun aux quatre outils.

    Quarante-quatre pixels de côté au minimum : c'est la cible tactile que le
    RGAA et les recommandations d'Apple demandent, et c'est aussi ce qui évite
    qu'une icône de vingt-deux pixels ne devienne un piège au doigt.

    `relative` parce que deux d'entre eux portent une pastille de comptage,
    posée en absolu sur leur coin.
  */
  const outil =
    'relative flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors duration-150 ease-out hover:bg-surface hover:text-stamp'

  return (
    <header className="nav-plein sticky top-0 z-50">
      {/*
        La couture ferme le BORD BAS de la barre.

        Une barre pleine largeur n'a pas de côtés : elle touche les deux bords
        de la fenêtre, et un cadre y dessinerait deux traits verticaux qui ne
        délimitent rien. Reste sa seule arête réelle, celle du bas, là où la
        barre rencontre la page. C'est la couture d'un ourlet plutôt que celle
        d'une ceinture, et elle remplace le filet d'un pixel qu'on aurait mis
        sinon — un trait régulier, précisément ce que la charte écarte partout
        ailleurs.
      */}
      <div
        aria-hidden
        className="nav-bar__couture pointer-events-none absolute inset-x-0 bottom-0 h-[9px] transition-opacity duration-150 ease-out"
      >
        <Surpiqure
          forme="ligne"
          ton="clair"
          retrait={0}
          desordre={0.55}
          graine={41}
          hauteurDeReference={9}
        />
      </div>

      <div className="nav-bar relative px-4 py-4 sm:px-6 sm:py-5 lg:px-10">
        {/*
          La signature sans sa baseline : une barre de navigation porte le nom
          de la boutique, pas son argument. La baseline reste là où elle
          informe — en tête de vitrine et dans le colophon.
        */}
        <Wordmark size="md" tagline={false} className="nav-bar__mark" />

        <nav
          aria-label={t('mainNav')}
          /*
            Les chemins ne se replient plus dès 768 px.

            Mesuré : entre 768 et 900 px, les quatre libellés passaient sur
            deux lignes et la barre montait de quatre-vingt-quatre à
            quatre-vingt-douze pixels. C'était déjà une irrégularité ; c'est
            devenu une erreur depuis que le bandeau remonte d'une hauteur de
            barre CONSTANTE, car la remontée ne vaut plus la bonne valeur dans
            cette plage — un filet blanc apparaîtrait au-dessus de la photo.

            L'écart entre les chemins se resserre donc d'un cran jusqu'à
            1024 px, où la place revient. Le repli reste autorisé sous 768 px :
            là, les chemins ont leur propre registre et la barre n'a pas de
            hauteur à tenir.
          */
          className="nav-bar__nav flex flex-wrap items-center gap-x-5 gap-y-1 md:flex-nowrap lg:gap-x-7"
        >
          {chemins.map((chemin) => (
            <Link key={chemin.href} href={chemin.href} className={lien}>
              {chemin.label}
            </Link>
          ))}
        </nav>

        <div className="nav-bar__tools flex items-center justify-end gap-0.5 sm:gap-1">
          {/*
            La recherche est un composant à part, et pour une raison de fond :
            elle n'est pas un lien mais un PANNEAU qui s'ouvre, et elle doit
            s'ouvrir sans JavaScript. Le mécanisme est expliqué chez elle.
          */}
          <HeaderSearch
            classeOutil={outil}
            libelleOuvrir={t('openSearch')}
            libelleFermer={t('closeSearch')}
          />

          {/*
            L'entrée « compte » change de cible selon l'état de session : elle
            est donc rendue côté client, seule.
          */}
          <AccountNav classeOutil={outil} />

          {/*
            Le nom du lien est un `sr-only`, PAS un `aria-label`.

            Un `aria-label` remplace le contenu de l'élément pour un lecteur
            d'écran : il aurait effacé la pastille de comptage du nom
            accessible, et le nombre de favoris n'aurait jamais été annoncé.
            Le `title`, lui, reste — c'est l'infobulle à la souris, qui ne
            joue aucun rôle dans le nom accessible.
          */}
          <Link href="/favoris" className={outil} title={t('favorites')}>
            <IconeFavoris taille={22} />
            <span className="sr-only">{t('favorites')}</span>
            <FavoritesCountBadge />
          </Link>

          <Link href="/panier" className={outil} title={t('cart')}>
            <IconePanier taille={22} />
            <span className="sr-only">{t('cart')}</span>
            {/*
              Le compteur se charge après l'hydratation, comme l'état de
              session : le lire ici rendrait dynamiques toutes les pages que
              cette barre traverse, y compris celles qui portent le
              référencement.
            */}
            <CartCountBadge />
          </Link>
        </div>
      </div>
    </header>
  )
}
