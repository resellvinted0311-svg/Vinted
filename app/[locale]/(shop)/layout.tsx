import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ToastProvider } from '@/components/ui/toast'
import { FavoritesProvider } from '@/components/shop/favorites-provider'
import { NavigationProgress } from '@/components/shop/navigation-progress'
import { SiteHeader } from '@/components/shop/site-header'
import { SiteFooter } from '@/components/shop/site-footer'
import { blocSite, blocOrganisation } from '@/lib/seo/structured-data'
import { serializeJsonLd } from '@/lib/utils/json-ld'

/**
 * La boutique : en-tête, contenu, pied de page.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cette coque a QUITTÉ la mise en page de langue
 * ---------------------------------------------------------------------------
 * Elle y était, donc la régie en héritait : on administrait son stock à
 * l'intérieur de la vitrine, avec la recherche, le panier et le sélecteur de
 * langue au-dessus de la tête. Un retour arrière depuis un écran de gestion
 * pouvait ramener au catalogue sans qu'on l'ait demandé.
 *
 * En la descendant dans le groupe `(shop)`, elle ne couvre plus que ce qu'elle
 * décrit. `/admin`, qui vit à côté, ne la voit plus du tout et pose la sienne.
 *
 * ---------------------------------------------------------------------------
 * Les fournisseurs descendent avec elle, et c'est le but
 * ---------------------------------------------------------------------------
 * Favoris et notifications appartiennent à la boutique. La régie n'en utilise
 * aucun — vérifié avant de déplacer, pas supposé — et les lui servir revenait
 * à charger dans chaque écran de gestion un état de client qui n'y a pas de
 * sens.
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // Permet le rendu statique des pages publiques de cette langue. La mise en
  // page de langue l'appelle déjà ; le répéter ici est ce que demande
  // next-intl pour chaque segment susceptible d'être prérendu.
  setRequestLocale(locale)

  const t = await getTranslations('nav')

  /*
    Les deux blocs qui décrivent le SITE, et non une page.

    Ils vivent dans la coque de la boutique plutôt que dans l'accueil : un
    moteur n'entre pas toujours par l'accueil, et une fiche article isolée
    n'avait, jusqu'ici, rien qui la rattache à une entité connue. Ils ne
    couvrent en revanche pas la régie, qui n'est pas le site public.

    `blocOrganisation` rend `null` tant que l'identité légale n'est pas
    renseignée : la balise disparaît alors entièrement, plutôt que d'annoncer
    une entreprise sans nom.
  */
  const organisation = blocOrganisation()

  return (
    <ToastProvider>
      <FavoritesProvider>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(blocSite(locale)),
          }}
        />
        {organisation ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(organisation) }}
          />
        ) : null}
        {/*
          Le fil d'attente d'une navigation, posé au-dessus de tout le reste.

          Il vit dans la mise en page et non dans une page : il doit survivre
          au changement de page, puisque c'est précisément ce changement qu'il
          annonce.
        */}
        <NavigationProgress />

        <a
          href="#contenu"
          className="skip-link rounded-input ruled bg-surface px-3 py-2 text-base"
        >
          {t('skipToContent')}
        </a>

        <SiteHeader />

        <main id="contenu" className="flex-1">
          {children}
        </main>

        <SiteFooter />
      </FavoritesProvider>
    </ToastProvider>
  )
}
