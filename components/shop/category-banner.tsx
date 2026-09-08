import Image from 'next/image'
import {
  deliveryUrl,
  isVideoUrl,
  videoPosterUrl,
} from '@/lib/providers/storage/delivery'
import { HeroVideo } from './hero-video'

/**
 * Le bandeau d'un rayon, en tête de sa page.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi il est PLUS BAS que le bandeau d'accueil
 * ---------------------------------------------------------------------------
 * L'accueil peut se permettre un 16/9 : sa page n'a rien d'autre à montrer
 * au-dessus de la ligne de flottaison, et le visuel EST le propos.
 *
 * Une page de rayon a le propos inverse. Quelqu'un qui clique « Jeans » veut
 * voir des jeans, pas une image de jeans. Le bandeau annonce l'endroit où l'on
 * vient d'arriver, puis s'efface : d'où un 3/1, et un plafond en unités de
 * fenêtre pour que les premières pièces restent visibles sans défiler.
 *
 * C'est la règle que `phase0.spec.ts` tient depuis le début, et elle protège
 * les ventes : un bandeau qui remplit la fenêtre ne montre aucune pièce, et un
 * visiteur qui ne voit pas de produit s'en va.
 *
 * ---------------------------------------------------------------------------
 * Trois pièges de proportion, déjà payés une fois sur le bandeau d'accueil
 * ---------------------------------------------------------------------------
 *  1. `w-full` n'est pas décoratif. Une proportion se résout à partir de la
 *     dimension CONNUE : avec une hauteur minimale posée et une largeur libre,
 *     le navigateur calcule la largeur — et sur un téléphone de 390 px, le
 *     cadre en faisait 528. Le débordement était masqué par `overflow-hidden`,
 *     donc invisible jusqu'à ce qu'on aille lire les dimensions réelles.
 *
 *  2. `min-height` l'emporte TOUJOURS sur `max-height`. Le plafond ci-dessous
 *     ne mord donc que sur les fenêtres assez hautes pour que la proportion
 *     dépasse le plancher. C'est voulu, et c'est pour cela que le plancher est
 *     modeste.
 *
 *  3. `min-h-fit` avec une proportion se résout à la hauteur DE LA PROPORTION,
 *     pas à celle du contenu. On ne s'en sert pas.
 *
 * ---------------------------------------------------------------------------
 * L'emplacement du visuel existe avant le visuel
 * ---------------------------------------------------------------------------
 * Aucune catégorie ne porte encore d'image : le modèle `Category` n'a pas de
 * champ pour ça. Le cadre est néanmoins dessiné, sur le lavis d'accent, comme
 * les cartes de rayon le sont sans photographie.
 *
 * Ce n'est pas un pis-aller. Un emplacement vide dit ce que la page deviendra
 * et garde sa composition stable le jour où l'image arrive — alors qu'un
 * bandeau qui n'apparaîtrait qu'une fois la photo posée ferait sauter toute la
 * page à ce moment-là. `imageUrl` est déjà là pour recevoir la source.
 */
export function CategoryBanner({
  /** Le nom du rayon. C'est le titre de la page : il n'est plus répété ailleurs. */
  title,
  /** Texte éditorial court, quand la catégorie en a un. */
  intro,
  /** Le visuel du rayon, quand il en a un. */
  imageUrl = null,
  /**
   * Le point de l'image qui reste ANCRÉ une fois l'image recadrée.
   *
   * Attention au piège : la proportion du cadre n'est PAS le 3/1 annoncé plus
   * bas. `max-h-[34svh]` mord presque toujours avant, et le cadre va du 6/1
   * au 2.2/1 selon la fenêtre — ce qui fait varier du simple au triple la part
   * de la photographie qu'on voit. Un cadrage choisi en visant une bande n'est
   * donc juste que sur la fenêtre où il a été choisi.
   *
   * `lib/design/category-banners.ts` explique comment poser cette valeur pour
   * qu'elle tienne sur toutes les fenêtres.
   */
  cadrage = '50% 50%',
  /** Description de l'image ; vide si elle est décorative. */
  alt = '',
}: {
  title: string
  intro?: string | null
  imageUrl?: string | null
  cadrage?: string
  alt?: string
}) {
  // Une vidéo et une photographie occupent le même cadre : servir une vidéo
  // dans une balise `img` n'afficherait rien — un cadre vide, sans erreur.
  const estVideo = imageUrl !== null && isVideoUrl(imageUrl)
  const affiche = imageUrl !== null ? videoPosterUrl(imageUrl) : null

  return (
    <section className="relative isolate overflow-hidden ruled-b">
      <div className="relative aspect-[3/1] max-h-[34svh] min-h-[11rem] w-full">
        {/* Le lavis, qui tient lieu de fond tant qu'aucune image n'est posée. */}
        <div aria-hidden className="wash-accent absolute inset-0 -z-10" />

        {imageUrl && estVideo ? (
          <HeroVideo
            src={deliveryUrl(imageUrl)}
            poster={affiche ?? ''}
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
        ) : null}

        {imageUrl && !estVideo ? (
          <Image
            src={deliveryUrl(imageUrl)}
            alt={alt}
            fill
            priority
            // Le bandeau est en pleine largeur : la valeur est exacte plutôt
            // qu'approchée. Une valeur fausse ici coûte des centaines de
            // kilo-octets sur la vue qui porte le LCP.
            sizes="100vw"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
            /*
              Le cadrage passe par un STYLE et non par une classe utilitaire.

              Tailwind fabrique ses classes en lisant le code source : il ne
              peut pas en produire une à partir d'une valeur qui n'existe qu'à
              l'exécution. Écrire `object-[${cadrage}]` compilerait sans erreur
              et ne produirait aucune règle — le cadrage serait silencieusement
              ignoré, ce qui est exactement le genre de défaut qu'on ne voit
              qu'en comparant deux captures.
            */
            style={{ objectPosition: cadrage }}
          />
        ) : null}

        {/*
          Le voile n'existe QUE s'il y a une photographie.

          Sur le lavis, on connaît le contraste et il est bon. Sur une image, on
          ne sait rien : un titre posé sur un ciel clair est le défaut le plus
          banal du bandeau d'e-commerce. Le voile est la contrepartie de
          l'image, pas une décoration permanente.

          -------------------------------------------------------------------
          Pourquoi DEUX dosages, et non un seul jeu de pourcentages
          -------------------------------------------------------------------
          Le cadre garde son 3/1 aux deux tailles, mais le titre ne suit pas la
          même échelle : `type-section` est un `clamp(1.75rem, 3.6vw, 2.75rem)`
          plafonné sur grand écran et plancherisé sur téléphone. Le même titre
          occupe donc un quart de la hauteur du cadre sur un écran de bureau, et
          près de la moitié sur un téléphone — où il passe en outre à deux
          lignes. Un voile en pourcentages ne peut pas servir les deux : réglé
          pour le bureau il laisse le téléphone à découvert, réglé pour le
          téléphone il noie la photographie sur grand écran.

          Les deux dosages ci-dessous sont les PLUS LÉGERS qui tiennent 4.5:1,
          mesurés encre masquée sous la boîte réelle du titre, aux deux tailles
          réelles du bandeau (1440×480 et 390×177) :

            bureau   6.02:1     téléphone   5.05:1

          Et ils ne sont pas mesurés sur « Pulls et sweats », qui tient sur une
          ligne en français et ne prouve rien. Le pire cas est le nom de rayon
          le plus long de la base — « Sobretudos e casacos acolchoados », en
          portugais — qui passe à deux lignes sur téléphone et fait remonter la
          première exactement là où le voile s'arrêtait. Avec le voile de
          bureau, ce titre-là tombait à 3.08:1 : illisible, et invisible pour
          qui ne regarde que le français.
        */}
        {imageUrl ? (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--paper)_94%,transparent)_0%,color-mix(in_oklab,var(--paper)_66%,transparent)_46%,transparent_76%)] sm:bg-[linear-gradient(to_top,color-mix(in_oklab,var(--paper)_92%,transparent)_0%,color-mix(in_oklab,var(--paper)_58%,transparent)_34%,transparent_62%)]"
          />
        ) : null}

        {/*
          Le texte est à GAUCHE et EN BAS.

          À gauche parce que c'est là que commence la lecture, et que le titre
          se retrouve ainsi aligné sur la grille du contenu qui suit — mêmes
          marges que le fil d'Ariane et que la grille de pièces, si bien que la
          page tient sur une seule colonne d'appui.

          En bas parce que le jour où une photographie arrivera, c'est le haut
          du cadre qui portera le sujet.
        */}
        <div className="mx-auto flex h-full max-w-[80rem] flex-col justify-end gap-2 px-4 pb-6 sm:px-6 sm:pb-8">
          <h1 className="type-section font-display font-bold uppercase text-ink">
            {title}
          </h1>

          {intro ? (
            <p className="max-w-xl text-base text-muted">{intro}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
