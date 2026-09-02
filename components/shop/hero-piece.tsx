import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { formatPrice, formatGrams, formatDate } from '@/lib/utils/format'
import type { PublicArticleCard } from '@/lib/db/selectors'
import { ArticleImage } from './article-image'
import { pickTranslation } from './article-card'
import { Stamp } from '@/components/ui/stamp'
import { SeedHeadPlate } from '@/components/shop/engraving'
import { Reveal } from '@/components/motion/reveal'
import { PointerDrift } from '@/components/motion/pointer-drift'

/**
 * La pièce du moment.
 *
 * Premier écran de la boutique, et parti pris central de la refonte : on
 * n'arrive pas sur un rayon mais sur une vitrine. Une seule pièce, en grand,
 * avec son relevé complet — c'est ce qu'une boutique où chaque article est
 * unique peut faire et qu'un catalogue de tailles multiples ne peut pas.
 *
 * La composition est délibérément décentrée : le titre chevauche la
 * photographie, le relevé descend en colonne étroite le long du bord. Une
 * grille sage produirait la page d'accueil de n'importe quelle boutique.
 */
export async function HeroPiece({
  article,
  locale,
}: {
  article: PublicArticleCard
  locale: string
}) {
  const t = await getTranslations('home')
  const tArticle = await getTranslations('article')
  const tCat = await getTranslations('catalogue')
  const tCondition = await getTranslations('condition')

  const translation = pickTranslation(article.translations, locale)
  const title = translation?.title ?? article.sku
  const cover = article.images[0]

  /**
   * Les premières lignes de la description, s'il y en a une.
   *
   * Le nom d'une pièce d'occasion tient en trois mots ; la vitrine restait
   * donc muette entre le titre et le relevé. Ces deux lignes disent ce qu'une
   * ligne de données ne dit pas — la coupe, l'époque, le défaut assumé.
   *
   * `null` plutôt qu'un texte de remplacement : une pièce sans description
   * n'en reçoit pas d'inventée, la composition se referme simplement.
   */
  const excerpt = translation?.description?.trim() || null

  const record: { label: string; value: string }[] = [
    { label: tArticle('reference'), value: article.sku },
    /*
      L'état, qui manquait.

      C'est la première chose qu'on veut savoir d'un vêtement d'occasion, avant
      la matière et bien avant le poids d'expédition — et le relevé de la
      vitrine était le seul endroit du site à ne pas le donner. Il est
      volontairement placé haut, juste après la référence.
    */
    { label: tArticle('condition'), value: tCondition(`${article.condition}.label`) },
    { label: tArticle('size'), value: article.sizeLabel },
    ...(article.material
      ? [
          {
            label: tArticle('material'),
            value: tCat(`materials.${article.material}`),
          },
        ]
      : []),
    {
      label: tArticle('weight'),
      value: formatGrams(article.weightGrams, locale),
    },
    ...(article.publishedAt
      ? [
          {
            label: tArticle('identification'),
            value: formatDate(article.publishedAt, locale),
          },
        ]
      : []),
  ]

  return (
    /*
      Aucun fond propre : la vitrine laisse passer celui de la page.

      Elle en avait un — un crème uni doublé d'un halo — et c'est ce qui
      dessinait une ligne horizontale nette sous la barre de navigation : la
      bande occupée par l'en-tête montrait le fond du document, la vitrine
      montrait le sien, et la couture entre les deux se lisait comme un trait
      tiré en travers de la page. Il n'y avait rien à effacer : il fallait
      supprimer l'un des deux fonds.
    */
    <section className="relative overflow-hidden ruled-b">
      {/*
        La gravure occupe la droite de la vitrine.

        La composition est décentrée par construction — la pièce et son relevé
        tiennent la gauche et le centre — ce qui laissait un quart d'écran de
        crème inoccupé à droite. Le végétal au trait est le motif éditorial de
        la charte : il remplit ce quart sans rien y ajouter à lire, là où un
        bloc de texte y aurait fabriqué du discours pour meubler.

        Masqué en dessous de 1024 px : la composition s'y met en pile et le
        trait traverserait le relevé.

        Le haut n'est plus débordé : la gravure partait seize pixels au-dessus
        de la section, donc `overflow-hidden` la tranchait net au ras du bord
        supérieur — un second trait horizontal, exactement là où on venait d'en
        supprimer un. Elle commence maintenant à l'intérieur.
      */}
      <SeedHeadPlate className="pointer-events-none absolute -right-24 top-0 hidden h-[125%] w-auto select-none text-engraving opacity-25 lg:block" />

      {/*
        La respiration a été réduite sur grand écran, et seulement là.

        Objectif tenu : la pièce du moment — visuel, nom, prix, relevé, appel —
        se lit d'un seul coup d'œil sur un écran de bureau, sans défiler. Sur
        téléphone, la composition se déroule de toute façon en pile : la
        générosité d'origine y est conservée.
      */}
      <div className="relative mx-auto max-w-[80rem] px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:pb-8 lg:pt-6">
        <Reveal>
          <p className="label-reg text-mark">{t('featured')}</p>
        </Reveal>

        {/*
          Sur grand écran, la photographie occupe six colonnes et le bloc de
          titre repart de la sixième : ils se chevauchent d'une colonne, et ce
          chevauchement est ce qui casse la grille produit.

          Les DEUX portent `row-start-1`. Placer un seul des deux
          explicitement suffit à rejeter l'autre en ligne suivante : le
          placement automatique refuse de traverser une cellule déjà occupée,
          et la photo se retrouvait sous le pli au lieu d'être derrière le
          titre.

          En dessous de lg, tout se remet en pile — superposer du texte sur
          une photo étroite le rendrait illisible.
        */}
        <div className="mt-6 lg:mt-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-8">
          <Reveal
            from="left"
            className="lg:col-span-4 lg:col-start-1 lg:row-start-1"
          >
            {/*
              Le cadre rétrécit en COLONNES, et garde son rapport 4:5.

              Le plafonner en hauteur aurait été plus direct, et c'est le
              premier essai : à cinq colonnes de large et vingt-six rem de
              haut, le cadre devenait paysage. Or `object-cover` remplit le
              cadre — un vêtement photographié debout s'y serait fait couper la
              tête et les pieds pour n'en montrer que le milieu. Le rapport
              d'un cadre produit n'est pas une variable de mise en page : c'est
              la largeur qui cède.
            */}
            <Link
              href={`/a/${article.slug}`}
              className="group block overflow-hidden rounded-card ruled bg-sand"
            >
              <PointerDrift strength={16}>
                <div className="aspect-[4/5] w-full">
                  {cover ? (
                    <ArticleImage
                      image={cover}
                      // Quatre colonnes sur douze depuis le resserrement : la
                      // valeur suit, sinon le navigateur télécharge une image
                      // deux fois trop large sur la vue qui porte le LCP.
                      sizes="(min-width: 1024px) 25rem, 100vw"
                      priority
                    />
                  ) : (
                    <div className="wash-accent h-full w-full" aria-hidden />
                  )}
                </div>
              </PointerDrift>
            </Link>
          </Reveal>

          {/*
            Sept colonnes et non neuf : le relevé est calé à droite de SA
            colonne, donc une colonne plus large le repoussait vers le bord de
            l'écran et creusait un vide au milieu de la composition. Il termine
            maintenant à l'aplomb du titre.
          */}
          <div className="relative z-10 mt-6 lg:col-span-7 lg:col-start-4 lg:row-start-1 lg:mt-6">
            <Reveal delay={120}>
              <h1 className="type-hero font-display font-bold uppercase text-ink">
                <Link
                  href={`/a/${article.slug}`}
                  className="transition-colors duration-200 ease-out hover:text-stamp"
                >
                  {title}
                </Link>
              </h1>
            </Reveal>

            {excerpt ? (
              <Reveal delay={160}>
                {/*
                  Deux lignes au plus, coupées par le navigateur : la vitrine
                  cite, elle ne recopie pas la fiche. Une description de dix
                  lignes rendrait au premier écran le défaut qu'on vient d'en
                  chasser.
                */}
                <p className="mt-4 line-clamp-2 max-w-xl text-lg text-muted">
                  {excerpt}
                </p>

                {/*
                  La même mention que sur la fiche, au même endroit du texte.

                  Citer une description fabriquée sans le dire la ferait passer
                  pour une description rédigée. C'est le genre de fausse
                  impression qui use la confiance dans toutes les autres
                  mentions du site — et la vitrine est la page la plus lue.
                */}
                {article.descriptionIsGenerated ? (
                  <p className="mt-1.5 text-xs text-muted">
                    {tArticle('generatedDescription')}
                  </p>
                ) : null}
              </Reveal>
            ) : null}

            <Reveal delay={200}>
              {/*
                Le relevé est posé sur une fiche opaque : à cet endroit il
                déborde sur la photographie, et du texte fin sur un visuel ne
                se lit pas.
              */}
              <div className="mt-6 max-w-md rounded-card ruled bg-paper-raised p-5 lg:mt-5 lg:ml-auto lg:p-4">
                {article.brand ? (
                  <p className="label-reg text-muted">{article.brand.name}</p>
                ) : null}

                <p className="mt-3 flex items-baseline gap-3">
                  <span
                    data-numeric
                    className="font-display text-3xl font-bold tracking-tight text-ink"
                  >
                    {formatPrice(article.priceCents, locale)}
                  </span>
                  <Stamp>{tArticle('uniquePiece')}</Stamp>
                </p>

                <dl className="mt-5 lg:mt-4">
                  {record.map((entry) => (
                    <div
                      key={entry.label}
                      className="flex items-baseline justify-between gap-4 border-t border-sand py-2 lg:py-1"
                    >
                      <dt className="label-reg text-muted">{entry.label}</dt>
                      <dd className="data text-base text-ink">{entry.value}</dd>
                    </div>
                  ))}
                </dl>

                <Link
                  href={`/a/${article.slug}`}
                  className="lift mt-5 inline-flex min-h-[48px] items-center rounded-input border-[1.5px] border-stamp bg-stamp px-6 font-medium text-ink-inverse lg:mt-4"
                >
                  {t('featuredCta')}
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
