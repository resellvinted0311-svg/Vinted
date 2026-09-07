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
  /** Le visuel du rayon, quand il en aura un. */
  imageUrl = null,
}: {
  title: string
  intro?: string | null
  imageUrl?: string | null
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
            alt=""
            fill
            priority
            // Le bandeau est en pleine largeur : la valeur est exacte plutôt
            // qu'approchée. Une valeur fausse ici coûte des centaines de
            // kilo-octets sur la vue qui porte le LCP.
            sizes="100vw"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
        ) : null}

        {/*
          Le voile n'existe QUE s'il y a une photographie.

          Sur le lavis, on connaît le contraste et il est bon. Sur une image, on
          ne sait rien : un titre posé sur un ciel clair est le défaut le plus
          banal du bandeau d'e-commerce. Le voile est la contrepartie de
          l'image, pas une décoration permanente.
        */}
        {imageUrl ? (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--paper)_92%,transparent)_0%,color-mix(in_oklab,var(--paper)_58%,transparent)_50%,transparent_100%)]"
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
