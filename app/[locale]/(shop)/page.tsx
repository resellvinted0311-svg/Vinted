import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import {
  getLatestArticles,
  countListedArticles,
} from '@/lib/db/queries/articles'
import {
  listCategoriesWithCounts,
  listBrandsWithCounts,
} from '@/lib/db/queries/taxonomy'
import { HeroPiece } from '@/components/shop/hero-piece'
import { ArrivalsRail } from '@/components/shop/arrivals-rail'
import { TypeIndex } from '@/components/shop/type-index'
import { BranchPlate, SeedHeadPlate } from '@/components/shop/engraving'
import { Marquee } from '@/components/motion/marquee'
import { Reveal } from '@/components/motion/reveal'

/**
 * Vitrine, pas rayon.
 *
 * L'accueil n'ouvre PAS sur une grille filtrable : c'est la structure de tous
 * les sites de vêtements, et c'est précisément ce dont la boutique doit se
 * distinguer. Il ouvre sur une pièce, en grand, avec son relevé — ce qu'une
 * boutique où chaque article est unique peut montrer et qu'un catalogue de
 * tailles multiples ne peut pas. Le catalogue devient une destination qu'on
 * choisit, annoncée en bas de page.
 *
 * La descente est écrite comme une séquence : la pièce, l'arrivage, la
 * méthode, l'index, l'entrée. Chaque section a sa propre respiration.
 *
 * Rendu statique régénéré toutes les 60 secondes. L'accueil porte le
 * référencement et la cible LCP : il reste prérendu. En Phase 2, la
 * régénération sera aussi déclenchée à la demande au changement de statut d'un
 * article, pour qu'une pièce vendue quitte la vitrine sans attendre
 * l'échéance.
 */
export const revalidate = 60

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('home')
  const tSite = await getTranslations('site')
  const tNav = await getTranslations('nav')

  const [latest, categories, brands, total] = await Promise.all([
    getLatestArticles(locale, 9),
    listCategoriesWithCounts(locale),
    listBrandsWithCounts(),
    countListedArticles(),
  ])

  const [featured, ...arrivals] = latest

  // Les trois étapes forment une vraie séquence — on chine, on prépare, on
  // expédie — donc la numérotation porte une information. Ailleurs, un numéro
  // décoratif serait du remplissage.
  const steps = [
    { title: t('howItWorks.sourcingTitle'), body: t('howItWorks.sourcingBody') },
    {
      title: t('howItWorks.selectionTitle'),
      body: t('howItWorks.selectionBody'),
    },
    {
      title: t('howItWorks.shippingTitle'),
      body: t('howItWorks.shippingBody'),
    },
  ]

  if (!featured) {
    return (
      <section className="mx-auto max-w-[80rem] px-4 py-24 sm:px-6">
        <div className="rounded-card ruled bg-surface p-10">
          <h1 className="type-section font-display font-bold uppercase">
            {tSite('tagline')}
          </h1>
          <p className="mt-4 text-base text-ink">{t('emptyCatalogue')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyCatalogueHint')}</p>
        </div>
      </section>
    )
  }

  return (
    <>
      <HeroPiece article={featured} locale={locale} />

      {/* Trois faits vérifiables, jamais une promesse invérifiable : un
          bandeau qui défile attire l'œil, il ne doit pas servir de réclame. */}
      <Marquee
        items={[t('claimUnique'), t('claimMeasured'), t('claimShipped')]}
      />

      <ArrivalsRail articles={arrivals} locale={locale} />

      {/* --------------------------------------------------------------------
          La méthode.

          C'est ici que la gravure prend toute sa place — grand format, au
          trait, derrière le texte. Elle ne descend jamais dans un contrôle
          (voir engraving.tsx).
          -------------------------------------------------------------------- */}
      <section className="relative overflow-hidden ruled-t ruled-b bg-paper-raised">
        {/* Plus effacée et plus repoussée sur petit écran : la colonne y est
            unique, la gravure traverserait le texte des étapes. */}
        <SeedHeadPlate className="pointer-events-none absolute -left-28 top-0 h-full w-auto select-none text-engraving opacity-[0.18] sm:-left-10 sm:opacity-30" />

        <div className="relative mx-auto max-w-[80rem] px-4 py-16 sm:px-6 sm:py-24">
          <Reveal>
            {/* Le dégradé descend dans les TITRES DE SECTION. Il ne tenait
                jusqu'ici que le bouton principal et deux filets : la teinte du
                site ne se voyait qu'en la cherchant. Un titre de section fait
                trois à six centimètres de haut — c'est une surface, et la
                lettre y garde tout son contraste. */}
            <h2 className="text-gradient type-section max-w-3xl font-display font-bold uppercase">
              {t('howItWorks.title')}
            </h2>
          </Reveal>

          <ol className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-6">
            {steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 110}>
                <li className="flex flex-col">
                  {/* Chiffre en contour : un graphisme fait de type. */}
                  <span
                    aria-hidden
                    className="type-outline data font-display text-[4.5rem] font-bold leading-none tracking-tight"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    aria-hidden
                    className="mt-4 block h-[1.5px] w-full bg-rule"
                  />
                  <h3 className="mt-5 text-lg">{step.title}</h3>
                  <p className="mt-2 text-base text-muted">{step.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------------------------
          Index.

          Les entrées du catalogue en composition pleine largeur plutôt qu'en
          pastilles : le compteur cesse d'être une décoration et dit où le
          catalogue est fourni.
          -------------------------------------------------------------------- */}
      <section className="mx-auto max-w-[80rem] px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <TypeIndex
            title={t('indexCategories')}
            entries={categories.map((category) => ({
              href: `/c/${category.path}`,
              label: category.name,
              count: category.articleCount,
            }))}
          />

          <TypeIndex
            title={t('indexBrands')}
            entries={brands.map((brand) => ({
              href: `/marque/${brand.slug}`,
              label: brand.name,
              count: brand.articleCount,
            }))}
            footer={
              <Link
                href="/marques"
                className="label-reg text-muted underline underline-offset-4 hover:text-ink"
              >
                {tNav('brands')}
              </Link>
            }
          />
        </div>
      </section>

      {/* --------------------------------------------------------------------
          L'entrée du catalogue.

          Elle vit en bas de page, et c'est le choix structurant : le rayon est
          une destination qu'on choisit, pas la porte d'entrée.
          -------------------------------------------------------------------- */}
      {/*
        La plus grande surface d'accent du site.

        Elle était en encre pleine, et c'était le dernier endroit où le rose et
        le cuivre auraient dû se voir sans se voir. Le fond devient le dégradé
        lui-même : sur la descente de la page, la teinte ouvre (le bandeau de
        faits) et referme (ici), et la vitrine tient entre les deux.

        Tout ce qui est posé dessus passe à `--ink-inverse`, à PLEINE opacité.
        La hiérarchie se fait au corps et à la graisse, pas à la transparence :
        un texte à 60 % sur l'extrémité cuivre du dégradé tomberait à 3,3:1,
        sous le seuil AA, alors qu'il le passe largement à pleine encre.
      */}
      <section className="gradient-accent relative overflow-hidden ruled-t text-ink-inverse">
        <BranchPlate className="pointer-events-none absolute -right-10 -top-16 h-[150%] w-auto select-none text-ink-inverse opacity-20" />

        <div className="relative mx-auto max-w-[80rem] px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <p className="label-reg">{tSite('tagline')}</p>

            <h2 className="type-section mt-5 max-w-3xl font-display font-bold uppercase">
              {t('browseTitle')}
            </h2>

            <p className="mt-6 max-w-xl text-lg">{t('browseBody')}</p>

            <div className="mt-10 flex flex-wrap items-center gap-6">
              <Link
                href="/catalogue"
                className="inline-flex min-h-[56px] items-center rounded-input border-[1.5px] border-paper bg-paper px-8 font-display font-bold uppercase tracking-tight text-ink transition-transform duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5"
              >
                {t('browseCta')}
              </Link>

              <p className="data label-reg">
                {t('registerCount', { count: total })}
              </p>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}
