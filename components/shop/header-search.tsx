import { IconeRecherche } from './icones'
import { SearchBox } from './search-box'

/**
 * La recherche, ouverte depuis la loupe de la barre.
 *
 * ---------------------------------------------------------------------------
 * Un panneau qui s'ouvre SANS JavaScript
 * ---------------------------------------------------------------------------
 * La boutique fonctionne script coupé — c'est une garantie tenue par des
 * tests, et elle a déjà rattrapé deux régressions. Une loupe qui ouvrirait son
 * champ par un gestionnaire d'événement ne serait donc pas « dégradée » sans
 * script : elle serait MORTE, et la recherche deviendrait inatteignable depuis
 * la barre.
 *
 * Le mécanisme est celui du volet de filtres : une case à cocher masquée dont
 * l'étiquette est la loupe visible. Cocher, c'est ouvrir. Aucun script n'y
 * participe, ni pour ouvrir, ni pour fermer, ni pour soumettre — le champ est
 * un formulaire GET qui mène au catalogue.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un PANNEAU sous la barre, et pas un champ toujours visible
 * ---------------------------------------------------------------------------
 * Un champ permanent dans la barre coûte la place de deux entrées de
 * navigation sur un téléphone, pour un outil dont on se sert rarement : on
 * arrive sur une boutique de pièces uniques pour PARCOURIR, et l'on cherche
 * quand on sait déjà ce qu'on veut.
 *
 * Une page de recherche dédiée aurait été l'autre option. Elle a été écartée
 * parce qu'elle fait perdre la page où l'on est : on tape « Levi's », on
 * arrive sur les résultats, et l'on a quitté le rayon qu'on parcourait. Le
 * panneau, lui, se referme sur place tant qu'on n'a rien validé.
 *
 * ---------------------------------------------------------------------------
 * Où va la recherche
 * ---------------------------------------------------------------------------
 * Vers `/catalogue`, avec la requête en paramètre. C'est la page qui sait
 * afficher des résultats — grille, décompte, filtres, tri — et lui confier la
 * recherche évite d'entretenir un second écran de résultats qui divergerait
 * du premier.
 */
export function HeaderSearch({
  classeOutil,
  libelleOuvrir,
  libelleFermer,
}: {
  /** Le gabarit commun aux quatre outils de la barre. */
  classeOutil: string
  libelleOuvrir: string
  libelleFermer: string
}) {
  return (
    <>
      {/*
        La case est en position FIXE, pas en `sr-only`.

        `sr-only` positionne en ABSOLU : la case resterait à sa place dans la
        page, et lui donner le focus ferait remonter le navigateur jusqu'à
        elle — c'est-à-dire jusqu'en haut. Le défaut a été mesuré sur le volet
        de filtres, où ouvrir le panneau ramenait la page à son sommet. Ici
        l'écart serait plus petit, la barre étant déjà en haut, mais le motif
        est le même et il n'y a aucune raison de le répéter.

        Un pixel, sans opacité, toujours focalisable : le clavier y accède, et
        l'étiquette porte la marque de focus à sa place.
      */}
      <input
        type="checkbox"
        id="nd-recherche"
        className="peer fixed left-0 top-0 h-px w-px opacity-0"
      />

      {/*
        DEUX étiquettes pour une seule case, et c'est voulu : l'une ouvre,
        l'autre ferme, et une seule des deux est visible à la fois. Sans cela
        il faudrait un bouton — donc du script — pour refermer.
      */}
      <label
        htmlFor="nd-recherche"
        title={libelleOuvrir}
        className={`${classeOutil} cursor-pointer peer-checked:hidden peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]`}
      >
        <IconeRecherche taille={22} />
        <span className="sr-only">{libelleOuvrir}</span>
      </label>

      <label
        htmlFor="nd-recherche"
        title={libelleFermer}
        className={`${classeOutil} hidden cursor-pointer peer-checked:flex`}
      >
        <span aria-hidden className="text-2xl leading-none">
          ×
        </span>
        <span className="sr-only">{libelleFermer}</span>
      </label>

      {/*
        Le panneau, sous la barre.

        `invisible` et non `hidden` : `hidden` couperait l'ouverture en deux
        temps, mais surtout un panneau replié qui resterait seulement décalé
        garderait son champ dans l'ordre de tabulation. On tabulerait dans un
        champ de recherche invisible.

        Il est posé en absolu par rapport à l'en-tête, donc il recouvre le
        contenu au lieu de le pousser : ouvrir la recherche ne doit pas faire
        sauter la page qu'on est en train de lire.
      */}
      <div className="invisible absolute inset-x-0 top-full -z-10 border-b border-sand bg-paper px-4 py-4 opacity-0 shadow-[0_10px_24px_-20px_color-mix(in_oklab,var(--ink)_70%,transparent)] transition-opacity duration-150 peer-checked:visible peer-checked:z-0 peer-checked:opacity-100 motion-reduce:transition-none sm:px-6 lg:px-10">
        {/*
          `SearchBox` porte déjà sa cible et son intitulé : elle compose son
          action à partir de la langue courante et prend son texte d'invite
          dans les messages. On ne les lui repasse pas — deux sources pour la
          même chaîne, c'est deux endroits à corriger et un seul qu'on pense à
          relire.
        */}
        <div className="mx-auto max-w-[42rem]">
          <SearchBox className="w-full" />
        </div>
      </div>
    </>
  )
}
