import Image from 'next/image'
import {
  deliveryUrl,
  isVideoUrl,
  videoPosterUrl,
  MAX_DELIVERY_WIDTH_PLEINE_LARGEUR,
} from '@/lib/providers/storage/delivery'
import { HeroVideo } from './hero-video'
import { BarreSurImage } from './barre-sur-image'

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
 * vient d'arriver, puis s'efface : d'où une proportion large et un plafond en
 * unités de fenêtre pour que les premières pièces restent visibles sans
 * défiler.
 *
 * La géométrie exacte vit dans `.bandeau-cadre`, côté feuille de style, et non
 * dans des classes utilitaires : le bandeau doit pouvoir grandir quand il passe
 * sous la barre de navigation, et une utilitaire l'emporte sur toute règle de
 * composant quel que soit le sélecteur. Elle a été relevée de 30 % à la demande
 * de la boutique — proportion, plancher et plafond ensemble.
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
   * Attention au piège : la proportion du cadre n'est PAS celle qui est
   * déclarée. Le plafond en unités de fenêtre mord presque toujours avant, et
   * le cadre va du 4,5/1 au 1,7/1 selon la fenêtre — ce qui fait varier du
   * simple au triple la part de la photographie qu'on voit. Un cadrage choisi
   * en visant une bande n'est donc juste que sur la fenêtre où il a été
   * choisi.
   *
   * `lib/design/category-banners.ts` explique comment poser cette valeur pour
   * qu'elle tienne sur toutes les fenêtres.
   */
  cadrage = '50% 50%',
  /**
   * Agrandissement de la photographie DANS son cadre, 1 = taille naturelle.
   *
   * `object-fit: cover` remplit déjà le cadre : l'image n'y flotte jamais, et
   * le seul moyen de rapprocher le sujet est de l'agrandir au-delà de ce
   * remplissage. Le débordement est rogné par le cadre, qui masque ce qui
   * dépasse.
   *
   * L'agrandissement part du POINT D'ANCRAGE, pas du centre : sans cela, un
   * cadrage soigneusement posé à 58 % se déplacerait à chaque changement de
   * valeur, et il faudrait rerégler les deux ensemble.
   *
   * Il ne coûte pas de netteté ici : les sources font 5 992 px de large pour
   * un cadre servi à 3 200 au plus, soit près du double de ce qu'on affiche.
   */
  zoom = 1,
  /** Description de l'image ; vide si elle est décorative. */
  alt = '',
}: {
  title: string
  intro?: string | null
  imageUrl?: string | null
  cadrage?: string
  zoom?: number
  alt?: string
}) {
  // Une vidéo et une photographie occupent le même cadre : servir une vidéo
  // dans une balise `img` n'afficherait rien — un cadre vide, sans erreur.
  const estVideo = imageUrl !== null && isVideoUrl(imageUrl)
  const affiche = imageUrl !== null ? videoPosterUrl(imageUrl) : null

  return (
    /*
      LA PHOTOGRAPHIE REMONTE SOUS LA BARRE, le lavis non.

      Demandé tel quel : la barre doit se confondre dans l'image. Elle ne le
      peut que si l'image commence au pixel zéro de la fenêtre — d'où la
      remontée d'une hauteur de barre, portée par `.bandeau-sous-barre` et
      décrite dans la feuille de style.

      Elle est réservée aux rayons qui ont une photographie, et ce n'est pas
      une économie : sous la barre, un rayon sans image ferait passer le lavis
      d'accent DERRIÈRE des libellés à l'encre blanche — un lavis clair, une
      encre claire, la navigation disparaîtrait. Le lavis reste donc sous une
      barre blanche, à sa place.
    */
    <section
      className={`relative isolate overflow-hidden ruled-b${imageUrl ? ' bandeau-sous-barre' : ''}`}
    >
      <div className="bandeau-cadre">
        {/* Le lavis, qui tient lieu de fond tant qu'aucune image n'est posée. */}
        <div aria-hidden className="wash-accent absolute inset-0 -z-10" />

        {imageUrl && estVideo ? (
          <HeroVideo
            src={deliveryUrl(imageUrl, {
              width: MAX_DELIVERY_WIDTH_PLEINE_LARGEUR,
            })}
            poster={affiche ?? ''}
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
        ) : null}

        {imageUrl && !estVideo ? (
          <Image
            src={deliveryUrl(imageUrl, {
              width: MAX_DELIVERY_WIDTH_PLEINE_LARGEUR,
            })}
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
            style={{
              objectPosition: cadrage,
              ...(zoom === 1
                ? {}
                : { transform: `scale(${zoom})`, transformOrigin: cadrage }),
            }}
          />
        ) : null}

        {/*
          AUCUN voile sur la photographie — c'est une demande explicite.

          -------------------------------------------------------------------
          Ce que le voile faisait, et ce qui le remplace
          -------------------------------------------------------------------
          Un dégradé sombre couvrait le bas du cadre pour garantir le contraste
          du titre. Il marchait, et il avait un défaut réel : il éteignait la
          photographie sur toute sa moitié basse. Une photo choisie pour un
          rayon est censée se voir.

          Mais le problème qu'il réglait, lui, ne disparaît pas. Le titre est
          blanc et la photographie est inconnue : un mur clair, un ciel, une
          pierre de seuil, et le titre s'efface. Le chiffre mesuré sans voile
          ni ombre est reporté plus bas, sur l'ombre elle-même.

          L'ombre portée règle exactement le même problème sans toucher à
          l'image. Elle ne pose de l'encre que dans le halo des LETTRES : la
          photographie n'est ni assombrie ni éclaircie, et le contraste devient
          celui du blanc contre le halo, non plus celui du blanc contre ce qui
          se trouve derrière. C'est le traitement classique d'une légende sur
          photographie, et il est réversible d'une ligne.

          Deux ombres superposées, et chacune a sa raison :
            - une très courte et opaque, qui détache le bord du glyphe ;
            - une large et diffuse, qui éteint un fond clair sur quelques
              pixels autour du mot sans dessiner de contour visible.
        */}

        {/*
          Le texte est à GAUCHE et EN BAS.

          À gauche parce que c'est là que commence la lecture, et que le titre
          se retrouve ainsi aligné sur la grille du contenu qui suit — mêmes
          marges que le fil d'Ariane et que la grille de pièces, si bien que la
          page tient sur une seule colonne d'appui.

          En bas parce que le jour où une photographie arrivera, c'est le haut
          du cadre qui portera le sujet.
        */}
        <div
          className="mx-auto flex h-full max-w-[var(--colonne)] flex-col justify-end gap-2 px-4 pb-6 sm:px-6 sm:pb-8"
          // L'ombre ne sert QUE s'il y a une photographie derrière. Sur le
          // lavis, le contraste est connu et bon : une ombre n'y ajouterait
          // qu'une salissure autour des lettres.
          style={
            imageUrl
              ? {
                  textShadow:
                    '0 1px 2px rgba(11,17,28,0.92), 0 2px 14px rgba(11,17,28,0.78)',
                }
              : undefined
          }
        >
          {/*
            L'encre du titre dépend de CE QU'IL Y A DERRIÈRE, pas du thème.

            Elle était prise dans le jeton `--ink`. Ce jeton a changé de valeur
            le jour où la boutique est passée au fond blanc : d'un blanc cassé
            il est devenu un bleu nuit, et le titre s'est retrouvé en bleu nuit
            sur une photographie — mesuré sur « PULLS ET SWEATS », illisible
            contre un bardage sombre. Le défaut n'était visible sur aucune page
            sans image, donc sur aucune des captures qui avaient servi à
            valider la bascule.

            Une photographie ne suit pas le thème : elle est claire ou sombre
            en elle-même, dans les deux thèmes. Le blanc est donc écrit, comme
            sur les cartes de rayon, et l'ombre portée plus haut garantit le
            contraste quel que soit le cliché.
          */}
          <h1
            className={`type-section font-display font-bold uppercase ${
              imageUrl ? 'text-white' : 'text-ink'
            }`}
          >
            {title}
          </h1>

          {intro ? (
            <p
              className={`max-w-xl text-base ${
                imageUrl ? 'text-white' : 'text-muted'
              }`}
            >
              {intro}
            </p>
          ) : null}
        </div>

        {/*
          Le repère de défilement, tout en bas du cadre.

          Il ne sert QUE sur les rayons à photographie : ailleurs, la barre est
          blanche du premier au dernier pixel et n'a aucune bascule à faire.
        */}
        {imageUrl ? <BarreSurImage /> : null}
      </div>
    </section>
  )
}
