'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { addToCartAction } from '@/lib/shop/cart-actions'
import { notifyCartChanged } from './cart-events'

/**
 * Mettre une pièce au panier.
 *
 * ---------------------------------------------------------------------------
 * Aucun stock n'est réservé ici
 * ---------------------------------------------------------------------------
 * Mettre au panier n'immobilise rien : le verrou est pris à l'ouverture du
 * paiement, et pas avant. Réserver dès l'ajout immobiliserait le catalogue
 * pour des paniers abandonnés — sur un stock où chaque pièce existe en un seul
 * exemplaire, ce serait fermer la boutique à tous les autres.
 *
 * Le bouton ne le promet donc pas. Il ne dit pas « réservé pour vous », il ne
 * décompte rien, et l'écran de la pièce reste ce qu'il était.
 *
 * ---------------------------------------------------------------------------
 * Les cinq refus sont traduits
 * ---------------------------------------------------------------------------
 * Le résultat du serveur porte cinq motifs, et chacun a son message. Les
 * rabattre sur un « une erreur est survenue » commun ferait dire la même chose
 * à « cette pièce vient d'être vendue » et à « elle est déjà dans votre
 * panier », qui appellent pourtant deux gestes opposés.
 */
export function AddToCartButton({
  articleId,
  label,
}: {
  articleId: string
  label: string
}) {
  const t = useTranslations('cart')
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      size="lg"
      fullWidth
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await addToCartAction(articleId)

          if (!result.ok) {
            toast({
              tone: result.reason === 'already-in-cart' ? 'neutral' : 'warning',
              title: t(`errors.${result.reason}`),
              ...(result.reason === 'already-in-cart'
                ? {
                    action: {
                      label: t('openCart'),
                      onClick: () => router.push('/panier'),
                    },
                  }
                : {}),
            })
            // Une pièce devenue indisponible : la fiche affiche encore l'état
            // d'avant. On relit plutôt que de laisser un écran qui ment.
            if (result.reason === 'not-purchasable') router.refresh()
            return
          }

          notifyCartChanged(result.totalCount)
          toast({
            tone: 'success',
            title: t('added'),
            action: {
              label: t('openCart'),
              onClick: () => router.push('/panier'),
            },
          })
        })
      }}
    >
      {label}
    </Button>
  )
}
