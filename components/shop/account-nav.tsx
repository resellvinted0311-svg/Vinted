'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/lib/i18n/navigation'
import { IconeCompte } from './icones'

interface SessionState {
  signedIn: boolean
}

/**
 * Entrée « compte » de la barre de navigation.
 *
 * ---------------------------------------------------------------------------
 * UNE entrée, et rien d'autre
 * ---------------------------------------------------------------------------
 * Elle portait le prénom, un lien « Admin » et un bouton « Se déconnecter ».
 * Trois éléments de plus en permanence à l'écran, dont deux qui n'ont de sens
 * qu'une fois — on se déconnecte rarement, on entre dans la régie encore moins
 * — et un prénom qui transformait une barre de navigation en tableau de bord.
 *
 * Tout cela vit maintenant dans l'espace compte, qui est l'endroit prévu pour
 * ça : le prénom en titre, l'accès à la régie, et la déconnexion en bas. La
 * barre garde ce qui est un CHEMIN — une entrée qui mène là-bas — et rien de
 * ce qui est une commande.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la session est lue côté client
 * ---------------------------------------------------------------------------
 * Lire la session dans la barre — qui vit dans le layout — sortirait TOUTES
 * les pages du cache statique, catalogue et fiches articles compris, puisqu'un
 * accès aux cookies bascule la route entière en rendu dynamique. Les cibles de
 * la section 15 (LCP < 2,5 s, pages indexables) ne le supportent pas.
 *
 * Mesuré : avec ce découpage, /fr répond `x-nextjs-cache: HIT`.
 *
 * Tant que l'état n'est pas connu, on réserve la largeur plutôt que d'afficher
 * « Se connecter » puis de le remplacer : cela éviterait un décalage de mise
 * en page (CLS).
 */
export function AccountNav({ classeOutil }: { classeOutil: string }) {
  const t = useTranslations('nav')
  const tAuth = useTranslations('auth')
  const pathname = usePathname()
  const [session, setSession] = useState<SessionState | null>(null)

  // L'état est relu à chaque changement d'URL, et pas seulement au montage.
  //
  // Ce composant vit dans le layout : il survit aux navigations côté client.
  // Avec une dépendance vide, il resterait bloqué sur l'état observé lors du
  // tout premier rendu — après une connexion, la barre continuerait d'afficher
  // « Se connecter » jusqu'au prochain rechargement complet.
  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/session', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SessionState | null) => {
        if (data) setSession({ signedIn: data.signedIn })
      })
      .catch(() => {
        // Un échec réseau ne doit pas casser la barre : on retombe sur l'état
        // déconnecté, qui reste utilisable.
        setSession({ signedIn: false })
      })

    return () => {
      controller.abort()
    }
  }, [pathname])

  /*
    Tant que l'état est inconnu, on RÉSERVE la place au lieu de l'occuper.

    Le raisonnement n'a pas changé — afficher « Se connecter » puis le
    remplacer décale la mise en page — mais sa mise en œuvre s'est simplifiée
    avec l'icône : la réserve n'est plus une largeur de texte devinée, c'est
    exactement le carré de l'outil. Les quatre outils gardent donc leur
    alignement du premier rendu au dernier, sans le moindre saut.
  */
  if (session === null) {
    return <span aria-hidden className={classeOutil} />
  }

  const libelle = session.signedIn ? t('account') : tAuth('signIn')

  return (
    <Link
      href={session.signedIn ? '/compte' : '/connexion'}
      className={classeOutil}
      title={libelle}
    >
      <IconeCompte taille={22} />
      {/*
        Le nom est un `sr-only` et non un `aria-label`, par cohérence avec les
        deux outils voisins qui portent un compteur : là-bas un `aria-label`
        effacerait le nombre du nom accessible. Ici il n'y a rien à effacer,
        mais quatre outils construits de quatre façons différentes est
        exactement ce qui produit, six mois plus tard, celui qu'on a oublié de
        corriger.

        Le libellé DIT ce qui va se passer : « Se connecter » quand on ne
        l'est pas, « Mon compte » quand on l'est. Une icône de personne, seule,
        ne dit ni l'un ni l'autre.
      */}
      <span className="sr-only">{libelle}</span>
    </Link>
  )
}
