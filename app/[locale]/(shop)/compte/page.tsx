import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from '@/lib/i18n/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link } from '@/lib/i18n/navigation'
import { signOutAction } from '@/lib/auth/actions'

/**
 * Rendu dynamique explicite.
 *
 * Next le déduit déjà de la lecture de session (vérifié : la réponse porte
 * `Cache-Control: private, no-store` même sans cette ligne). On la garde
 * comme garantie : une page de compte ne doit jamais devenir cacheable à la
 * faveur d'un remaniement qui déplacerait la lecture de session ailleurs.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'account' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // Le middleware n'a vérifié que la présence du cookie : le contrôle qui
  // fait autorité est ici, contre la base.
  const user = await getCurrentUser()
  if (!user) {
    redirect({ href: '/connexion', locale })
    // `redirect` de next-intl n'est pas typé `never` : ce retour est
    // inatteignable, il sert uniquement à l'affinage de type.
    return null
  }

  const t = await getTranslations('account')
  const tp = await getTranslations('privacy')
  const tAuth = await getTranslations('auth')

  /*
    Uniquement les rubriques qui EXISTENT.

    ---------------------------------------------------------------------------
    Le défaut que ce retrait corrige
    ---------------------------------------------------------------------------
    Cette liste en comptait huit ; quatre d'entre elles n'ont jamais eu de
    route. `/compte/messages`, `/compte/retours`, `/compte/alertes` et
    `/compte/parametres` renvoyaient une 404 — dans les huit langues, depuis le
    premier écran que voit une personne qui vient de se connecter.

    La moitié d'un menu qui ne mène nulle part ne se lit pas comme un chantier
    en cours : elle se lit comme un site cassé, et à cet endroit précis, chez
    quelqu'un qui vient de confier un mot de passe.

    ---------------------------------------------------------------------------
    Ce qui n'est pas perdu
    ---------------------------------------------------------------------------
    Les libellés restent dans les huit catalogues : `account.messages`,
    `account.returns`, `account.alerts`, `account.settings`. Ce ne sont pas des
    clés orphelines à nettoyer, ce sont les rubriques à construire — le suivi
    des retours dépend du modèle `ReturnRequest`, qui existe au schéma et n'est
    encore jamais écrit ; les alertes de taille dépendent de `SizeAlert`, de
    même. Le jour où la route existe, la ligne revient ici et le libellé est
    déjà traduit.

    `/favoris` reste dans la liste : la route existe, hors du dossier `compte`
    parce que les favoris fonctionnent aussi sans compte.
  */
  const sections = [
    { href: '/compte/commandes', label: t('orders') },
    { href: '/compte/offres', label: t('offers') },
    { href: '/favoris', label: t('favorites') },
    { href: '/compte/donnees', label: tp('myData.title') },
  ] as const

  return (
    <div className="mx-auto w-full max-w-[60rem] px-4 pb-24 pt-12 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl">
          {t('greeting', { name: user.firstName ?? user.email })}
        </h1>
        {user.role === 'ADMIN' ? <Badge tone="stamp">Administration</Badge> : null}
      </div>

      <ul className="mt-8 grid gap-px overflow-hidden rounded-card ruled bg-sand sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="flex min-h-[56px] items-center bg-surface px-4 text-base text-ink transition-colors duration-150 ease-out hover:bg-paper-raised"
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>

      {user.role === 'ADMIN' ? (
        <Link
          href="/admin"
          className="mt-8 inline-block text-base text-ink underline underline-offset-4"
        >
          Accéder au back-office
        </Link>
      ) : null}

      {/*
        La déconnexion, descendue de la barre de navigation.

        Elle y était affichée en permanence, sur chaque page, alors qu'on s'en
        sert une fois par session au plus. Ici elle est à sa place — au bas de
        l'espace compte, après ce qu'on vient y faire — et elle reste à deux
        clics de n'importe où.

        Un vrai <form> et non un bouton scripté : l'action serveur s'exécute
        sans JavaScript, et le rendu qui suit retombe sur la redirection vers
        la connexion, puisque la session n'existe plus.
      */}
      <form action={signOutAction} className="mt-10 border-t border-sand pt-6">
        <Button type="submit" variant="outline" size="sm">
          {tAuth('signOut')}
        </Button>
      </form>
    </div>
  )
}
