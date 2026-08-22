'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Notice } from '@/components/ui/notice'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { removeBlockedLinesAction } from '@/lib/shop/cart-actions'
import { MAX_LINES_PER_REQUEST } from '@/lib/validation/shop'
import { notifyCartChanged } from './cart-events'

/**
 * Ce qui bloque le paiement, nommé, avec un seul geste pour l'écarter.
 *
 * ---------------------------------------------------------------------------
 * Rien n'est retiré en silence
 * ---------------------------------------------------------------------------
 * Le cahier des charges l'interdit, et c'est la bonne règle : une ligne qui
 * disparaît toute seule laisse quelqu'un devant un total qui a changé sans
 * qu'il sache pourquoi. L'encart NOMME donc chaque pièce concernée, et le
 * retrait est un bouton que l'on presse.
 *
 * ---------------------------------------------------------------------------
 * Le découpage en tranches est dit
 * ---------------------------------------------------------------------------
 * Le serveur borne à vingt identifiants par appel — une clause `IN` qui reçoit
 * mille entrées est une porte ouverte. Au-delà, on enchaîne les appels, et le
 * bouton l'annonce plutôt que de laisser croire que tout est parti d'un coup.
 * Un panier réel n'atteint jamais ce cas ; le taire aurait quand même été un
 * mensonge par omission.
 */
export function BlockedLinesNotice({
  articles,
}: {
  /** Une entrée par pièce bloquante, dans l'ordre du bordereau. */
  articles: readonly { articleId: string; title: string }[]
}) {
  const t = useTranslations('cart.blocked')
  const tErrors = useTranslations('cart.errors')
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  if (articles.length === 0) return null

  const batches = Math.ceil(articles.length / MAX_LINES_PER_REQUEST)

  return (
    <Notice tone="warning" role="status" title={t('title', { count: articles.length })}>
      <p>{t('intro')}</p>

      <ul className="mt-2 flex flex-col gap-1">
        {articles.map((article) => (
          <li key={article.articleId} className="data text-xs text-ink">
            {article.title}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            if (!confirming) {
              setConfirming(true)
              return
            }

            startTransition(async () => {
              let lastCount: number | null = null

              for (let start = 0; start < articles.length; start += MAX_LINES_PER_REQUEST) {
                const slice = articles
                  .slice(start, start + MAX_LINES_PER_REQUEST)
                  .map((article) => article.articleId)

                const result = await removeBlockedLinesAction(slice)
                if (!result.ok) {
                  toast({ tone: 'danger', title: tErrors(result.reason) })
                  return
                }
                lastCount = result.totalCount
              }

              if (lastCount !== null) notifyCartChanged(lastCount)
              setConfirming(false)
              router.refresh()
            })
          }}
        >
          {confirming
            ? t('confirm')
            : batches > 1
              ? t('removePartial', {
                  count: MAX_LINES_PER_REQUEST,
                  total: articles.length,
                })
              : t('remove', { count: articles.length })}
        </Button>

        {confirming ? (
          <button
            type="button"
            className="label-reg min-h-[44px] text-muted underline-offset-4 hover:underline"
            onClick={() => setConfirming(false)}
          >
            {t('keep')}
          </button>
        ) : null}
      </div>
    </Notice>
  )
}
