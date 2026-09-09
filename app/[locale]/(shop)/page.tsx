import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import {
  getLatestArticles,
  countListedArticles,
} from '@/lib/db/queries/articles'
import { getFacets } from '@/lib/db/queries/articles'
import { EMPTY_FILTERS } from '@/lib/domain/catalogue'
import {
  getHomeHeroImageUrl,
  getUniverseImageUrls,
} from '@/lib/config/settings'
import { UNIVERSE_CARDS } from '@/lib/design/category-banners'
import { HeroBanner } from '@/components/shop/hero-banner'
import { ReassuranceBand } from '@/components/shop/reassurance-band'
import { ShortcutGrid } from '@/components/shop/shortcut-grid'
import { UniverseCards } from '@/components/shop/universe-cards'
import { ArrivalsRail } from '@/components/shop/arrivals-rail'
import { BranchPlate, SeedHeadPlate } from '@/components/shop/engraving'
import { Reveal } from '@/components/motion/reveal'

/**
 * Vitrine.
 *
 * ---------------------------------------------------------------------------
 * Ce qui a changé, et pourquoi
 * ---------------------------------------------------------------------------
 * L'accueil ouvrait sur UNE pièce, en grand, avec son relevé. C'était un parti
 * pris défendable — montrer ce qu'une boutique de pièces uniques peut montrer
 * et qu'un catalogue de tailles multiples ne peut pas — et il a été remplacé
 * sur décision du propriétaire, au profit du patron d'arrivée dominant : un
 * grand visuel paysage, puis les raccourcis vers le stock.
 *
 * La séquence : le visuel, les trois faits, les deux univers, ce qui vient
 * d'entrer, l'entrée par taille, l'entrée par catégorie, la méthode, le
 * catalogue.
 *
 * Les deux INDEX qui figuraient dans cette descente — catégories, puis marques
 * — ont été retirés. Tous deux doublaient la barre de navigation, et la page se
 * terminait par des relevés que personne ne lit avant d'avoir vu une pièce.
 *
 * Deux raccourcis — taille et catégorie — plutôt qu'un seul, et c'est le point
 * de cette page : sur un stock chiné, le visiteur n'a pas une envie de produit,
 * il a une taille. Le raccourci par taille mène directement à ce qu'il peut
 * acheter ; le raccourci par catégorie à ce qu'il cherchait.
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

  /*
    Les index de la vitrine ont été retirés, et leurs requêtes avec eux.

    Une section supprimée dont la requête reste dans le `Promise.all` continue
    de coûter un aller en base à chaque régénération de la page, pour un
    résultat que personne n'affiche. Ces requêtes-là sont invisibles : rien
    n'échoue, la page est simplement un peu plus lente pour rien.

    C'est arrivé pour les catégories, puis pour les marques : `brands` était
    encore chargé alors que plus rien ne l'affichait.
  */
  const [latest, total, facets, heroImageUrl, universeImages] =
    await Promise.all([
      // Huit pièces, et plus neuf : la vitrine ne prélève plus la première pour
      // en faire la pièce du moment. « Ajouté cette semaine » en montre huit.
      getLatestArticles(locale, 8),
      countListedArticles(),
      // Les facettes du catalogue SANS filtre : elles donnent les tailles et les
      // catégories avec leurs effectifs réels, en une seule série de requêtes.
      // Les recompter ici avec des requêtes maison ferait diverger les nombres
      // de l'accueil de ceux du catalogue, et c'est le genre d'écart qu'on ne
      // remarque jamais soi-même.
      getFacets(EMPTY_FILTERS, locale),
      getHomeHeroImageUrl(),
      getUniverseImageUrls(),
    ])

  // Les trois étapes forment une vraie séquence — on chine, on prépare, on
  // expédie — donc la numérotation porte une information. Ailleurs, un numéro
  // décoratif serait du remplissage.
  const steps = [
    {
      title: t('howItWorks.sourcingTitle'),
      body: t('howItWorks.sourcingBody'),
    },
    {
      title: t('howItWorks.selectionTitle'),
      body: t('howItWorks.selectionBody'),
    },
    {
      title: t('howItWorks.shippingTitle'),
      body: t('howItWorks.shippingBody'),
    },
  ]

  if (latest.length === 0) {
    return (
      <section className="mx-auto max-w-[var(--colonne)] px-4 py-24 sm:px-6">
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
      <HeroBanner imageUrl={heroImageUrl} />

      <ReassuranceBand />

      {/* --------------------------------------------------------------------
          Les deux univers, juste sous le visuel.

          C'est la première question de quelqu'un qui arrive sur une boutique
          de seconde main, avant même « qu'est-ce qui est nouveau » : est-ce
          que ce magasin a quelque chose pour moi. Y répondre en deux cartes
          évite de faire défiler un arrivage dont la moitié ne le concerne pas.

          Les deux cartes s'affichent TOUJOURS. Une première version se
          retirait tant qu'un des deux univers était vide : en production, où
          aucune pièce n'était encore rangée, la section demandée n'apparaissait
          alors pas du tout. Ces cartes sont la structure du magasin, pas un
          compte rendu de son stock.
          -------------------------------------------------------------------- */}
      {/*
        Le réglage de la régie l'emporte, le visuel versé au dépôt sert de
        socle. Pas l'inverse : un socle prioritaire rendrait l'écran de
        réglages impuissant à changer l'image, et personne ne comprendrait
        pourquoi une photo téléversée ne s'affiche pas.
      */}
      <UniverseCards
        audiences={facets.audiences}
        images={{
          femme: universeImages.femme ?? UNIVERSE_CARDS.femme.src,
          homme: universeImages.homme ?? UNIVERSE_CARDS.homme.src,
        }}
      />

      <ArrivalsRail articles={latest} locale={locale} />

      {/* --------------------------------------------------------------------
          Les deux raccourcis vers le stock.

          Ils viennent juste après l'arrivage parce que c'est là que le
          visiteur décide s'il reste : il a vu ce qui est entré, il veut
          maintenant ce qui LUI va. La taille passe avant la catégorie — sur
          un stock chiné, une catégorie sans sa taille ne mène à rien
          d'achetable.

          Les effectifs viennent des mêmes facettes que le catalogue, donc les
          nombres ne peuvent pas diverger. Une valeur à zéro n'apparaît pas :
          la facette ne la renvoie pas.
          -------------------------------------------------------------------- */}
      <ShortcutGrid
        title={t('shopBySize')}
        param="taille"
        entries={facets.sizes}
        limit={8}
      />

      <ShortcutGrid
        title={t('shopByCategory')}
        param="cat"
        entries={facets.categories}
        limit={6}
      />

      {/* --------------------------------------------------------------------
          La méthode.

          C'est ici que la gravure prend toute sa place — grand format, au
          trait, derrière le texte. Elle ne descend jamais dans un contrôle
          (voir engraving.tsx).
          -------------------------------------------------------------------- */}
      {/* Pas de fond propre : les filets suffisent à séparer la section, et le
          dégradé de page la traverse sans couture. */}
      <section className="relative overflow-hidden ruled-t ruled-b">
        {/* Plus effacée et plus repoussée sur petit écran : la colonne y est
            unique, la gravure traverserait le texte des étapes. */}
        <SeedHeadPlate className="pointer-events-none absolute -left-28 top-0 h-full w-auto select-none text-engraving opacity-[0.18] sm:-left-10 sm:opacity-30" />

        <div className="relative mx-auto max-w-[var(--colonne)] px-4 py-16 sm:px-6 sm:py-24">
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
          L'index des marques a été retiré de la vitrine.

          Il suivait le même sort que l'index des catégories avant lui, et pour
          la même raison : la barre de navigation porte déjà « Marques », et la
          descente de la page se terminait par un relevé que personne ne lit
          avant d'avoir vu une pièce.

          Ce qui compte : la page `/marques` n'est pas supprimée pour autant,
          et elle reste atteignable depuis la barre. Retirer la section EN
          MÊME TEMPS que son seul lien entrant aurait rendu toutes les pages de
          marque orphelines — indexables, et plus rien pour y mener. C'est
          exactement le défaut que les pages de catégorie ont connu.
          -------------------------------------------------------------------- */}

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

        <div className="relative mx-auto max-w-[var(--colonne)] px-4 py-20 sm:px-6 sm:py-28">
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
