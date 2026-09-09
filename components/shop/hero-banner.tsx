import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import {
  deliveryUrl,
  isVideoUrl,
  videoPosterUrl,
} from '@/lib/providers/storage/delivery'
import { HeroVideo } from './hero-video'

/**
 * Le grand visuel d'arrivée.
 *
 * ---------------------------------------------------------------------------
 * Un cadre 16/9, sur toute la largeur de l'écran
 * ---------------------------------------------------------------------------
 * C'est la proportion demandée, et c'est aussi celle que sortent un téléphone
 * et un appareil photo : une photographie posée là ne sera donc pas recadrée.
 *
 * La hauteur venait auparavant de la FENÊTRE — 75 % de la vue en bureau — et
 * c'était le défaut : un bandeau dimensionné en hauteur d'écran change de
 * proportion à chaque taille de navigateur, et ne ressemble jamais à un cadre.
 * On ne voyait pas où la photographie viendrait. Une proportion fixe, elle, se
 * lit comme un emplacement même vide.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi un plancher de hauteur en dessous de 768 px
 * ---------------------------------------------------------------------------
 * Sur un téléphone de 390 px de large, 16/9 fait 219 px de haut : le titre,
 * l'accroche et le bouton n'y tiennent pas — ils déborderaient du cadre ou
 * s'y feraient couper. Le plancher rend donc le cadre plus haut que 16/9 sur
 * petit écran, et c'est un écart assumé : mieux vaut une proportion inexacte
 * qu'un titre tronqué.
 *
 * Au-dessus, `min-h-fit` prend le relais : la proportion gouverne, mais le
 * cadre ne peut jamais devenir plus court que son propre contenu. C'est la
 * même précaution qu'avant — un titre de trois lignes arrive en allemand et en
 * néerlandais bien avant d'arriver en français.
 *
 * ---------------------------------------------------------------------------
 * L'emplacement vide est un état prévu, pas une panne
 * ---------------------------------------------------------------------------
 * La boutique n'a pas encore de photographie. Le cadre existe donc sans image :
 * il porte le lavis de la charte et la gravure au trait, il est composé, et il
 * ne montre nulle part qu'il manque quelque chose. Le jour où une adresse est
 * saisie en régie — Réglages, groupe « contenu » —, la photographie ou la vidéo
 * remplit ce cadre sans qu'aucune ligne de mise en page ne bouge.
 *
 * Ce qui est délibérément ABSENT de l'état vide : tout texte du genre « photo à
 * venir », et tout liseré en pointillés. Une vitrine n'annonce pas ses travaux
 * à ses clientes. C'est la PROPORTION qui dit où va la photographie, pas une
 * mention.
 *
 * ---------------------------------------------------------------------------
 * Ce que le navigateur peint en premier
 * ---------------------------------------------------------------------------
 * Quand l'image existe, elle devient l'élément mesuré par le LCP de la page la
 * plus vue du site. Elle est donc déclarée dans le HTML initial, en
 * `priority` — ce qui pose à la fois `fetchpriority="high"` et l'exclusion du
 * chargement différé — avec un `sizes` qui décrit sa largeur réelle. Sans
 * `sizes`, le navigateur suppose la pleine largeur de la fenêtre et télécharge
 * une image de deux mille pixels pour un téléphone.
 *
 * Le texte n'est PAS incrusté dans l'image : il est en HTML. Une accroche
 * gravée dans un fichier ne se traduit pas, ne se lit pas au lecteur d'écran,
 * et se pixellise au zoom.
 */
export async function HeroBanner({ imageUrl }: { imageUrl: string | null }) {
  const t = await getTranslations('home')

  // Une vidéo et une photographie occupent le même cadre et se règlent au même
  // endroit : la boutiquière colle une adresse, la page pose la bonne balise.
  // Servir une vidéo dans une balise `img` n'afficherait rien — un cadre vide,
  // sans la moindre erreur.
  const estVideo = imageUrl !== null && isVideoUrl(imageUrl)
  const affiche = imageUrl !== null ? videoPosterUrl(imageUrl) : null

  return (
    <section className="relative isolate overflow-hidden ruled-b">
      {/*
        La proportion est portée ICI, sur le cadre lui-même.

        `aspect-[16/9]` donne la hauteur à partir de la largeur, donc le cadre
        garde la même forme sur un portable et sur un grand moniteur. C'est ce
        qui le fait lire comme un emplacement, y compris vide.

        `min-h-[26rem]` vaut à TOUTES les tailles. Sur téléphone il relève un
        16/9 qui ne ferait que 219 px de haut ; ailleurs il garantit que le
        titre et le bouton ont toujours leur place. Il a été dimensionné du
        temps où une accroche s'intercalait entre les deux : il est désormais
        plus large que nécessaire, et on le laisse tel quel — c'est la hauteur
        minimale qui donne au cadre l'allure d'un cadre sur un téléphone.

        Il a d'abord été écrit `md:min-h-fit`, pour que le cadre ne soit jamais
        plus court que son contenu. C'était un piège : avec `aspect-ratio`,
        `fit-content` se résout à la hauteur DE LA PROPORTION — 720 px — et en
        CSS `min-height` l'emporte toujours sur `max-height`. Le plafond
        ci-dessous était donc calculé, appliqué, et sans le moindre effet. Le
        test de composition l'a montré ; la lecture du style calculé l'a
        expliqué.
      */}
      {/*
        `w-full` n'est PAS décoratif : sans lui, le cadre débordait l'écran.

        Une proportion se résout à partir de la dimension connue. Sur
        téléphone, `min-h-[26rem]` fixe la HAUTEUR ; la largeur devenait alors
        l'inconnue, et le navigateur la calculait — 416 px × 16/9 = 740 px de
        large dans une fenêtre de 390. Mesuré, pas supposé. Le débordement
        était masqué par `overflow-hidden` sur la section, donc invisible
        jusqu'à ce qu'on aille lire les dimensions réelles.

        En imposant la largeur, c'est la hauteur qui se déduit — le sens qu'on
        veut — et le plancher ne fait plus que la relever sur petit écran.

        `max-h-[74svh]` est un PLAFOND, et il mérite son explication.

        Sur une fenêtre de 1280 × 800, 16/9 donne 720 px : le cadre occupe 90 %
        de la vue, et plus aucune pièce n'est visible sans faire défiler. C'est
        la règle que `phase0.spec.ts` tient depuis le début, et elle protège les
        ventes : « un bandeau qui remplit la fenêtre ne montre aucune pièce, et
        un visiteur qui ne voit pas de produit s'en va ».

        Le plafond ne mord donc QUE sur les fenêtres basses. Au-delà de 1024 px
        de haut, 16/9 passe entier et la proportion est exacte. En dessous, le
        cadre s'aplatit un peu — il reste un bandeau paysage pleine largeur, et
        la photographie se recadre d'elle-même par `object-cover` au lieu de se
        déformer.
      */}
      <div className="relative aspect-[16/9] max-h-[74svh] min-h-[26rem] w-full">
        {/*
          Le cadre du visuel, qu'il y ait une image ou non.

          `aria-hidden` sur l'état vide : il n'y a rien à décrire. Un texte
          alternatif du type « emplacement d'image » serait annoncé à chaque
          arrivée sur la boutique, pour n'apprendre rien à personne.
        */}
        {/*
          Le lavis SEUL, sans gravure.

          La fleur au trait a été retirée d'ici à la demande de la boutique.
          Elle occupait le tiers droit du cadre, c'est-à-dire précisément la
          zone qu'une photographie doit remplir : un dessin sous une photo ne
          se voit pas, et un dessin sans photo donne au cadre l'air d'être déjà
          composé alors qu'il attend son visuel.

          Elle reste employée plus bas dans la page, où elle n'entre en
          concurrence avec rien.
        */}
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
            // Borne la largeur de la SOURCE : sans elle, l'optimiseur
            // retélécharge l'original — jusqu'à six mille pixels — pour chaque
            // largeur et chaque format qu'il fabrique, sur la vue qui porte
            // justement le LCP.
            src={deliveryUrl(imageUrl)}
            alt=""
            fill
            priority
            // Pleine largeur de fenêtre à toutes les tailles : le bandeau est
            // en pleine largeur, donc la valeur est exacte plutôt
            // qu'approchée. Une valeur fausse ici coûte des centaines de
            // kilo-octets sur la vue qui porte le LCP.
            sizes="100vw"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
        ) : null}

        {/*
          Le contenu est posé sur un voile, et le voile n'existe QUE s'il y a
          une photographie.

          Sur le lavis clair, l'encre passe à plus de douze pour un ; sur une
          photographie, on ne sait rien du contraste, et une accroche sombre
          sur un ciel clair est le défaut le plus banal du bandeau
          d'e-commerce. Le voile est donc la contrepartie de l'image, pas une
          décoration permanente.
        */}
        {imageUrl ? (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--paper)_92%,transparent)_0%,color-mix(in_oklab,var(--paper)_62%,transparent)_45%,transparent_100%)]"
          />
        ) : null}

        {/*
          `h-full` et non une hauteur à lui : le contenu épouse le cadre, dont
          la proportion est fixée au-dessus. Répéter ici une hauteur en unités
          de fenêtre — ce qu'il faisait — ferait deux sources de vérité pour une
          seule hauteur, et elles divergeraient au premier réglage.

          `justify-end` pose le texte en bas : sur une photographie, le haut
          porte en général le sujet, et le bas le ciel ou le sol — c'est là que
          l'encre se lit.
        */}
        <div className="mx-auto flex h-full max-w-[var(--colonne)] flex-col justify-end gap-5 px-4 pb-10 pt-16 sm:px-6 lg:pb-14">
          <h1 className="type-hero max-w-3xl font-display font-bold uppercase text-ink">
            {t('heroTitle')}
          </h1>

          {/*
            Pas d'accroche sous le titre : elle a été retirée à la demande de la
            boutique. Elle annonçait « lavée, contrôlée et mesurée, expédition
            sous 48 heures, retour sous 14 jours » — c'est-à-dire, mot pour mot,
            ce que la bande de réassurance répète immédiatement en dessous. Deux
            fois la même promesse à trois centimètres d'écart n'en renforce
            aucune.
          */}

          {/*
            Un seul appel, verbe et destination. Deux boutons côte à côte se
            concurrencent : le visiteur arbitre au lieu d'avancer.
          */}
          <div>
            <Link
              href="/catalogue"
              className="lift gradient-accent inline-flex min-h-[56px] items-center rounded-input border-[1.5px] border-stamp px-8 font-display font-bold uppercase tracking-tight text-ink-inverse"
            >
              {t('heroCta')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
