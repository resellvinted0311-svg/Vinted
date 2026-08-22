'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/toast'
import { removeFromCartAction } from '@/lib/shop/cart-actions'
import { notifyCartChanged } from './cart-events'

/**
 * Retirer une pièce du panier.
 *
 * Le libellé accessible NOMME la pièce : dans un bordereau de dix lignes, dix
 * boutons « Retirer » identiques rendent la liste inutilisable au clavier
 * comme au lecteur d'écran.
 *
 * Après retrait, `router.refresh()` relit la page côté serveur. Le décompte
 * n'est pas recalculé ici : c'est le serveur qui compte, et lui seul.
 */
export function CartRemoveButton({
  articleId,
  title,
}: {
  articleId: string
  title: string
}) {
  const t = useTranslations('cart')
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={isPending}
      aria-label={t('removeNamed', { title })}
      onClick={() => {
        startTransition(async () => {
          const result = await removeFromCartAction(articleId)

          if (!result.ok) {
            toast({
              tone: 'danger',
              title: t(`errors.${result.reason}`),
            })
            return
          }

          notifyCartChanged(result.totalCount)
          toast({ tone: 'neutral', title: t('removed', { title }) })
          router.refresh()
        })
      }}
      className="label-reg min-h-[44px] px-1 text-muted underline-offset-4 hover:text-danger hover:underline disabled:opacity-50"
    >
      {t('remove')}
    </button>
  )
}
