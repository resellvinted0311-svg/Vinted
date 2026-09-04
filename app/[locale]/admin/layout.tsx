import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, getMessages, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
import { SITE } from '@/lib/config/site'
import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'

/**
 * L'espace de régie.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le layout AUSSI appelle `requireAdmin()`
 * ---------------------------------------------------------------------------
 * Ce n'est pas une redondance de confort. Un layout est rendu pour TOUTES les
 * pages du segment, y compris celles qu'on ajoutera demain sans y penser :
 * c'est la seule protection qui ne dépende pas de la mémoire de la prochaine
 * personne. Et `tests/security/middleware-scope.test.ts` l'exige nommément —
 * il parcourt l'arborescence sous un segment `admin` et refuse tout `page`,
 * `layout` ou `route` qui ne contienne pas `requireAdmin`.
 *
 * Le coût est nul : `getCurrentUser` est mémorisé pour la durée d'un rendu, donc
 * le layout et la page ne font ensemble qu'UNE lecture en base.
 *
 * ---------------------------------------------------------------------------
 * Le refus est traité, jamais laissé remonter
 * ---------------------------------------------------------------------------
 * Redirection vers la connexion sans session, `notFound()` sur un rôle
 * insuffisant. Le raisonnement complet — et pourquoi la PAGE doit le faire
 * aussi — est dans `lib/auth/admin-guard.ts`.
 *
 * ---------------------------------------------------------------------------
 * La régie a sa PROPRE coque, et c'est un changement de fond
 * ---------------------------------------------------------------------------
 * Elle héritait auparavant de l'en-tête et du pied de page de la boutique :
 * on administrait son stock à l'intérieur de la vitrine, recherche et panier
 * au-dessus de la tête, et un retour arrière pouvait ramener au catalogue sans
 * qu'on l'ait demandé. Ces deux mondes n'ont ni le même métier ni le même
 * public — un seul les traverse, et c'est justement pour cela qu'il ne faut pas
 * qu'il se demande où il est.
 *
 * Aucun lien AMBIANT ne mène donc à la boutique. La seule sortie est nommée, et
 * elle s'ouvre dans un onglet neuf : la régie n'est jamais quittée par accident,
 * et l'historique du navigateur ne mélange pas les deux.
 */
export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin')
  const tNav = await getTranslations('nav')

  // ---------------------------------------------------------------------------
  // La régie remet l'espace `admin` que la mise en page publique a retiré
  // ---------------------------------------------------------------------------
  // Le fournisseur de la racine ne sert plus les libellés d'administration : ils
  // n'ont rien à faire dans la charge de chaque page publique. Les composants
  // clients d'ici en ont besoin — formulaires de pièces, de réglages, de
  // réponse aux offres — d'où ce second fournisseur, qui sert le jeu complet.
  //
  // Sans lui, les écrans afficheraient leurs clés brutes à la place des
  // libellés, et seulement une fois hydratés : le rendu serveur, lui, serait
  // correct. C'est le genre de défaut qu'on ne voit pas en relisant le code.
  const messages = await getMessages()

  const entrees = [
    { href: '/admin', label: t('dashboard') },
    { href: '/admin/pieces', label: t('articles.title') },
    // Juste après les pièces : c'est de là que viennent la plupart d'entre
    // elles, et c'est là qu'on va quand le catalogue paraît incomplet.
    { href: '/admin/inventaire', label: t('inventory.title') },
    // Juste après l'inventaire : une pièce importée arrive sans univers, et
    // tant qu'elle n'en a pas elle n'entre dans aucune des deux vitrines.
    // C'est donc le geste qui suit immédiatement une synchronisation.
    { href: '/admin/univers', label: t('audiences.title') },
    { href: '/admin/commandes', label: t('orders') },
    { href: '/admin/offres', label: t('offers') },
    { href: '/admin/reglages', label: t('settings.title') },
  ] as const

  return (
    <NextIntlClientProvider messages={messages}>
      <a
        href="#contenu"
        className="skip-link rounded-input ruled bg-surface px-3 py-2 text-base"
      >
        {tNav('skipToContent')}
      </a>

      {/*
        Barre d'outil, pas manchette de journal. La boutique se présente ; la
        régie s'annonce et s'efface. D'où une seule ligne, un fond distinct du
        papier de la vitrine, et aucune recherche ni panier.
      */}
      <header className="ruled-b bg-surface">
        <div className="mx-auto flex w-full max-w-[60rem] flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <span className="label-reg text-ink">
            {SITE.name} · {t('title')}
          </span>

          <nav
            aria-label={t('navLabel')}
            className="flex flex-1 flex-wrap gap-x-5 gap-y-1"
          >
            {entrees.map((entree) => (
              <Link
                key={entree.href}
                href={entree.href}
                className="label-reg text-muted hover:text-ink"
              >
                {entree.label}
              </Link>
            ))}
          </nav>

          {/*
            La seule porte vers la boutique, et elle est explicite.
            `target="_blank"` n'est pas une coquetterie : il garantit que la
            régie n'est pas QUITTÉE. Sans lui, consulter une fiche publique
            remplacerait l'écran de gestion, et le retour arrière ferait revenir
            dans la vitrine plutôt que dans l'outil.
          */}
          <a
            href={`/${locale}`}
            target="_blank"
            rel="noopener noreferrer"
            className="label-reg text-muted hover:text-ink"
          >
            {t('viewShop')}
          </a>
        </div>
      </header>

      <main
        id="contenu"
        className="mx-auto w-full max-w-[60rem] flex-1 px-4 pb-24 pt-10 sm:px-6"
      >
        {children}
      </main>
    </NextIntlClientProvider>
  )
}
