import { Link } from '@/lib/i18n/navigation'
import { Reveal } from '@/components/motion/reveal'

export interface IndexEntry {
  href: string
  label: string
  count: number
}

/**
 * Index typographique.
 *
 * Remplace les pastilles de catégories et de marques. Chaque entrée devient
 * une ligne pleine largeur, composée grand : le nombre de pièces cesse d'être
 * une décoration et devient l'information qui dit où le catalogue est fourni.
 *
 * Au survol, la ligne se décale vers la droite et un tiret se déploie devant
 * elle — un mouvement horizontal, à contre-emploi du soulèvement des fiches,
 * pour que les deux gestes ne se confondent pas.
 */
export function TypeIndex({
  title,
  entries,
  footer,
}: {
  title: string
  entries: IndexEntry[]
  footer?: React.ReactNode
}) {
  if (entries.length === 0) return null

  return (
    <div>
      <Reveal>
        {/* Filet de signature plutôt que filet plein : l'index ouvre une
            section, et c'est le repère que l'œil cherche en descendant. */}
        <h2 className="label-reg ruled-signature pb-3 text-muted">{title}</h2>
      </Reveal>

      <ul>
        {entries.map((entry, index) => (
          <Reveal key={entry.href} delay={Math.min(index, 6) * 45}>
            <li className="border-b border-sand">
              <Link
                href={entry.href}
                className="group flex items-baseline gap-4 py-3 sm:py-4"
              >
                <span
                  aria-hidden
                  className="h-[1.5px] w-0 shrink-0 self-center bg-mark transition-[width] duration-200 ease-out group-hover:w-8"
                />
                <span className="font-display text-xl font-bold uppercase leading-none tracking-tight text-ink transition-colors duration-200 ease-out group-hover:text-stamp sm:text-2xl">
                  {entry.label}
                </span>
                <span className="data ml-auto shrink-0 text-xs text-muted">
                  {String(entry.count).padStart(2, '0')}
                </span>
              </Link>
            </li>
          </Reveal>
        ))}
      </ul>

      {footer ? <div className="mt-5">{footer}</div> : null}
    </div>
  )
}
