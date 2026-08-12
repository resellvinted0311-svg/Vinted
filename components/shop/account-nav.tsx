'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter, usePathname } from '@/lib/i18n/navigation'
import { signOutAction } from '@/lib/auth/actions'

interface SessionState {
  signedIn: boolean
  firstName: string | null
  role: 'CUSTOMER' | 'ADMIN' | null
}

/**
 * Entrée « compte » de l'en-tête.
 *
 * Résolue côté client, et c'est le point important : lire la session dans
 * l'en-tête — qui vit dans le layout — sortirait TOUTES les pages du cache
 * statique, catalogue et fiches articles compris, puisqu'un accès aux cookies
 * bascule la route entière en rendu dynamique. Les cibles de la section 15
 * (LCP < 2,5 s, pages indexables) ne le supportent pas.
 *
 * Mesuré : avec ce découpage, /fr répond `x-nextjs-cache: HIT`.
 *
 * Tant que l'état n'est pas connu, on réserve la largeur plutôt que d'afficher
 * « Se connecter » puis de le remplacer : cela éviterait un décalage de mise
 * en page (CLS).
 */
export function AccountNav() {
  const t = useTranslations('nav')
  const tAuth = useTranslations('auth')
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<SessionState | null>(null)
  const [isPending, startTransition] = useTransition()

  // L'état est relu à chaque changement d'URL, et pas seulement au montage.
  //
  // Ce composant vit dans le layout : il survit aux navigations côté client.
  // Avec une dépendance vide, il resterait bloqué sur l'état observé lors du
  // tout premier rendu — après une connexion, l'en-tête continuerait
  // d'afficher « Se connecter » jusqu'au prochain rechargement complet.
  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/session', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SessionState | null) => {
        if (data) setSession(data)
      })
      .catch(() => {
        // Un échec réseau ne doit pas casser l'en-tête : on retombe sur
        // l'état déconnecté, qui reste utilisable.
        setSession({ signedIn: false, firstName: null, role: null })
      })

    return () => {
      controller.abort()
    }
  }, [pathname])

  if (session === null) {
    return <span aria-hidden className="inline-block h-5 w-24" />
  }

  if (!session.signedIn) {
    return (
      <Link
        href="/connexion"
        className="text-base text-ink underline underline-offset-4"
      >
        {tAuth('signIn')}
      </Link>
    )
  }

  return (
    <span className="flex items-center gap-3">
      <Link
        href="/compte"
        className="text-base text-ink underline underline-offset-4"
      >
        {session.firstName ?? t('account')}
      </Link>

      {session.role === 'ADMIN' ? (
        <Link
          href="/admin"
          className="text-base text-moss underline underline-offset-4"
        >
          Admin
        </Link>
      ) : null}

      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await signOutAction()
            setSession({ signedIn: false, firstName: null, role: null })
            router.refresh()
          })
        }}
        className="min-h-[44px] text-base text-muted transition-colors duration-150 ease-out hover:text-ink disabled:opacity-50"
      >
        {tAuth('signOut')}
      </button>
    </span>
  )
}
