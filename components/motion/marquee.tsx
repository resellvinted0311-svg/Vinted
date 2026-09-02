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
          {/* Le séparateur reprend l'encre du bandeau, atténuée. Il était en
              cuivre : sur un fond qui EST devenu cuivre, il disparaissait. */}
          <span aria-hidden className="opacity-60">
            ✳
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <div
      className={cn(
        // Le bandeau est l'une des trois grandes surfaces d'accent de la
        // boutique. Il coupe la page sur toute sa largeur, juste sous la pièce
        // du moment : c'est là que la teinte se voit, pas sur un liseré.
        //
        // Le libellé passe à `--ink-inverse` et reste à pleine opacité d'un
        // bout à l'autre du dégradé. Une hiérarchie posée en transparence
        // aurait fait tomber le contraste sous le seuil AA à l'extrémité
        // cuivre, où le fond est le plus clair.
        'marquee gradient-accent ruled-t ruled-b overflow-hidden py-2.5 text-ink-inverse',
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
