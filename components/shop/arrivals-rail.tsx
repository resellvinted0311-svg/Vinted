import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import type { PublicArticleCard } from '@/lib/db/selectors'
import { ArticleCard } from './article-card'
import { Reveal } from '@/components/motion/reveal'

/**
 * Rail d'arrivage.
 *
 * Le geste le plus marqué de la page : les dernières entrées défilent
 * horizontalement, à hauteurs inégales, et débordent volontairement du bord
 * droit. Une grille alignée dirait « catalogue » ; un rail qui sort du cadre
 * dit « il y en a d'autres, venez voir ».
 *
 * Le débordement est un vrai défilement natif — pas un carrousel scripté. Le
 * geste tactile, la molette horizontale, la navigation clavier et la barre de
 * défilement sont donc ceux du navigateur : rien à réimplémenter, rien à
 * casser. L'accrochage se fait en CSS (voir `.rail` dans globals.css).
 */
export async function ArrivalsRail({
  articles,
  locale,
}: {
  articles: PublicArticleCard[]
  locale: string
}) {
  const t = await getTranslations('home')

  if (articles.length === 0) return null

  return (
    <section className="py-16 sm:py-24 lg:py-8">
      <div className="mx-auto max-w-[80rem] px-4 sm:px-6">
        <Reveal>
          <div className="ruled-signature flex flex-wrap items-end justify-between gap-4 pb-4">
            <h2 className="text-gradient type-section font-display font-bold uppercase">
              {t('arrivals')}
            </h2>
            <Link
              href="/catalogue"
              className="label-reg pb-1 text-muted underline underline-offset-4 hover:text-ink"
            >
              {t('seeAll')}
            </Link>
          </div>
        </Reveal>
      </div>

      {/*
        Le rail commence à la marge de la page mais court jusqu'au bord de
        l'écran : c'est le débordement qui signale qu'on peut faire défiler.
        Le rembourrage de fin redonne de l'air à la dernière fiche.
      */}
      <Reveal from="right">
        <ul className="rail bleed-right mt-5 flex gap-4 overflow-x-auto lg:mt-4 lg:gap-5">
          {articles.map((article, index) => (
            <li
              key={article.id}
              className={[
                /*
                  Vingt-trois rem par fiche sur grand écran, c'était une
                  vignette de catalogue agrandie : trois pièces et demie
                  tenaient à l'écran, et la section dépassait la fenêtre d'un
                  bon tiers. À seize, on en voit cinq d'un coup — un rail se
                  lit au nombre de pièces qu'il montre, pas à leur taille.
                */
                'w-[70vw] shrink-0 sm:w-[42vw] lg:w-[15rem]',
                // Décalage vertical alterné : la ligne de base se brise, ce
                // qu'une grille de catalogue ne fait jamais. Réduit d'autant
                // que les fiches — il creusait à lui seul cinquante pixels.
                index % 2 === 1 ? 'lg:mt-4' : '',
              ].join(' ')}
            >
              <ArticleCard
                article={article}
                locale={locale}
                sizes="(min-width: 1024px) 15rem, (min-width: 640px) 42vw, 70vw"
                priority={index < 2}
              />
            </li>
          ))}

          {/* Rembourrage de fin : sans lui, la dernière fiche colle au bord. */}
          <li aria-hidden className="w-4 shrink-0 sm:w-6" />
        </ul>
      </Reveal>
    </section>
  )
}
