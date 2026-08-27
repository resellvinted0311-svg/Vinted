import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, getMessages, setRequestLocale } from 'next-intl/server'

import { Link } from '@/lib/i18n/navigation'
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
 * La chrome de la boutique est conservée
 * ---------------------------------------------------------------------------
 * En-tête et pied de page vivent dans le layout de langue, au-dessus de ce
 * groupe. Les en retirer supposerait de déplacer `<main id="contenu">`, donc de
 * tenir le lien d'évitement à deux endroits. Et cela n'aurait pas de sens ici :
 * la boutique a UN vendeur, qui passe de son catalogue à sa régie par le même
 * en-tête — celui-ci porte déjà le lien « Admin » quand le rôle s'y prête.
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

  return (
    <NextIntlClientProvider messages={messages}>
    <div className="mx-auto w-full max-w-[60rem] px-4 pb-24 pt-12 sm:px-6">
      <nav aria-label={t('navLabel')} className="mb-10 flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/admin" className="label-reg text-muted hover:text-ink">
          {t('title')}
        </Link>
        <Link href="/admin/pieces" className="label-reg text-muted hover:text-ink">
          {t('articles.title')}
        </Link>
        <Link href="/admin/commandes" className="label-reg text-muted hover:text-ink">
          {t('orders')}
        </Link>
        <Link href="/admin/offres" className="label-reg text-muted hover:text-ink">
          {t('offers')}
        </Link>
        <Link href="/admin/reglages" className="label-reg text-muted hover:text-ink">
          {t('settings.title')}
        </Link>
      </nav>

      {children}
    </div>
    </NextIntlClientProvider>
  )
}
