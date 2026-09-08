/**
 * Le trait d'attente, sans la logique qui décide de l'afficher.
 *
 * Deux composants s'en servent, pour deux attentes qui n'ont rien à voir :
 * `NavigationProgress` pendant un changement de page, `FormNavigation`
 * pendant un changement de filtre. Séparer le dessin de la décision évite
 * d'avoir deux traits qui divergeraient au premier réglage — c'est déjà
 * arrivé au filet de la barre de navigation.
 */
export function PendingBar() {
  return (
    <div
      aria-hidden
      // `role` et texte absents à dessein : le changement d'écran est déjà
      // annoncé aux lecteurs d'écran. Doubler l'annonce ferait parler deux
      // fois pour un seul événement.
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]"
    >
      <div className="nav-progress h-full origin-left bg-stamp" />
    </div>
  )
}
