import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { SeedHeadPlate } from '@/components/shop/engraving'

/**
 * Le grand visuel d'arrivée.
 *
 * ---------------------------------------------------------------------------
 * Trois quarts de la hauteur d'écran en bureau, et pas davantage
 * ---------------------------------------------------------------------------
 * C'est la proportion demandée. Elle est tenue par `min-height`, jamais par
 * `height` : un bandeau à hauteur FIXE se fait couper son propre texte dès
 * qu'un titre passe sur trois lignes — ce qui arrive en allemand et en
 * néerlandais avant d'arriver en français. La hauteur est donc un plancher,
 * et le contenu peut la dépasser.
 *
 * En dessous de 1024 px, la borne descend à 56 % de la fenêtre. La raison
 * n'est pas esthétique : sur un écran de téléphone, un bandeau qui remplit la
 * vue ne montre aucune pièce, et un visiteur qui ne voit pas de produit s'en
 * va. La première rangée du catalogue doit dépasser sous le pli. Le réglage
 * mobile reste à affiner.
 *
 * ---------------------------------------------------------------------------
 * L'emplacement vide est un état prévu, pas une panne
 * ---------------------------------------------------------------------------
 * La boutique n'a pas encore de photographie. Le cadre existe donc sans image :
 * il porte le lavis de la charte et la gravure au trait, il est composé, et il
 * ne montre nulle part qu'il manque quelque chose. Le jour où une adresse est
 * saisie en régie, la photographie remplace le lavis sans qu'aucune ligne de
 * mise en page ne bouge.
 *
 * Ce qui est délibérément ABSENT de l'état vide : tout texte du genre « photo à
 * venir ». Une vitrine n'annonce pas ses travaux à ses clientes.
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

  return (
    <section className="relative isolate overflow-hidden ruled-b">
      <div className="relative min-h-[56svh] lg:min-h-[75svh]">
        {/*
          Le cadre du visuel, qu'il y ait une image ou non.

          `aria-hidden` sur l'état vide : il n'y a rien à décrire. Un texte
          alternatif du type « emplacement d'image » serait annoncé à chaque
          arrivée sur la boutique, pour n'apprendre rien à personne.
        */}
        <div aria-hidden className="wash-accent absolute inset-0 -z-10">
          <SeedHeadPlate className="pointer-events-none absolute -right-20 top-0 hidden h-[130%] w-auto select-none text-engraving opacity-30 lg:block" />
        </div>

        {imageUrl ? (
          <Image
            src={imageUrl}
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

        <div className="mx-auto flex min-h-[56svh] max-w-[80rem] flex-col justify-end gap-5 px-4 pb-10 pt-16 sm:px-6 lg:min-h-[75svh] lg:pb-14">
          <h1 className="type-hero max-w-3xl font-display font-bold uppercase text-ink">
            {t('heroTitle')}
          </h1>

          <p className="max-w-xl text-lg text-muted">{t('heroSubtitle')}</p>

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
