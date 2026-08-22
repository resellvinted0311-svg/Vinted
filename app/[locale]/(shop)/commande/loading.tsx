import { Skeleton } from '@/components/ui/skeleton'

/**
 * Réserve d'espace pendant la lecture du panier et des grilles de port.
 *
 * Aux proportions des quatre volets. Aucun montant n'est esquissé : un total
 * qui apparaît puis change vaut moins qu'un total qui se fait attendre.
 */
export default function CheckoutLoading() {
  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
      <Skeleton className="h-8 w-56" />

      <div className="mt-8 flex flex-col gap-5">
        {['01', '02', '03', '04'].map((ordinal) => (
          <div key={ordinal} className="rounded-card ruled bg-surface p-5">
            <Skeleton className="h-3 w-32" />
            <div className="mt-4 flex flex-col gap-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
