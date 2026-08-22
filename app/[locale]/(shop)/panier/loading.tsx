import { Skeleton } from '@/components/ui/skeleton'

/**
 * Réserve d'espace pendant la lecture du panier.
 *
 * Aux proportions exactes du bordereau : trois lignes à gauche, un encart de
 * total à droite. Une réserve qui n'a pas la forme de son contenu produit
 * précisément le saut de mise en page qu'elle est censée éviter.
 *
 * Aucun chiffre n'est esquissé — pas de « 0 » ni de montant provisoire : un
 * total qui apparaît puis change est pire qu'un total qui se fait attendre.
 */
export default function CartLoading() {
  return (
    <div className="mx-auto max-w-[64rem] px-4 pb-24 pt-12 sm:px-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-3 w-24" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
        <ul className="divide-y divide-sand border-y-[1.5px] border-rule">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="grid grid-cols-[2.5rem_4.5rem_1fr] items-start gap-3 py-4 sm:gap-4"
            >
              <Skeleton className="h-3 w-5" />
              <Skeleton ratio="portrait" className="w-[4.5rem]" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-card ruled bg-surface p-5">
          <Skeleton className="h-3 w-24" />
          <div className="mt-4 flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
          <Skeleton className="mt-6 h-[52px] w-full" />
        </div>
      </div>
    </div>
  )
}
