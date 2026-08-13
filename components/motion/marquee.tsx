import { cn } from '@/lib/utils/cn'

/**
 * Bandeau défilant.
 *
 * Composant serveur, animation purement CSS : aucun script, donc aucun coût
 * au chargement pour un élément qui n'est que graphique.
 *
 * La séquence est rendue deux fois et l'animation translate d'exactement la
 * moitié de la largeur totale : le raccord est alors invisible et la boucle
 * n'a pas de saut. Le second exemplaire est masqué aux technologies
 * d'assistance — il ne dit rien de plus, il ne sert qu'à combler la ligne.
 *
 * Les mentions affichées sont des faits vérifiables (exemplaire unique, délai
 * d'expédition annoncé). Un bandeau qui défile attire l'œil ; y mettre une
 * promesse invérifiable en ferait une bannière publicitaire.
 */
export function Marquee({
  items,
  className,
}: {
  items: string[]
  className?: string
}) {
  if (items.length === 0) return null

  const sequence = (hidden: boolean): React.ReactNode => (
    <ul
      className="marquee__seq label-reg flex shrink-0 items-center"
      {...(hidden ? { 'aria-hidden': true } : {})}
    >
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-center">
          <span className="px-6">{item}</span>
          <span aria-hidden className="text-mark">
            ✳
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <div
      className={cn(
        'marquee ruled-t ruled-b overflow-hidden bg-ink py-2.5 text-paper',
        className,
      )}
    >
      <div className="marquee__track flex w-max">
        {sequence(false)}
        {sequence(true)}
      </div>
    </div>
  )
}
