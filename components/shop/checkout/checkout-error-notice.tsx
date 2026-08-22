'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Notice } from '@/components/ui/notice'
import { BlockedLinesNotice } from '@/components/shop/blocked-lines-notice'
import type { CartLineView } from '@/lib/shop/cart'

/**
 * Le refus du serveur, dit en une phrase et une seule.
 *
 * ---------------------------------------------------------------------------
 * Onze motifs, onze messages
 * ---------------------------------------------------------------------------
 * L'action de commande produit onze clés distinctes. Les rabattre sur un
 * « une erreur est survenue » ferait dire la même chose à « une pièce vient
 * d'être vendue » — où il faut retourner au panier — et à « le code postal
 * est invalide » — où il faut corriger deux caractères.
 *
 * ---------------------------------------------------------------------------
 * Le focus va sur le message
 * ---------------------------------------------------------------------------
 * Le bon de commande est long. Sans déplacement du focus, quelqu'un qui vient
 * d'appuyer sur « Commander » en bas de page ne voit rien changer : l'erreur
 * s'affiche au-dessus, hors de l'écran, et le bouton semble simplement mort.
 *
 * ---------------------------------------------------------------------------
 * Deux motifs nomment des pièces
 * ---------------------------------------------------------------------------
 * `blockedLines` et `stockTaken` renvoient des identifiants d'article. On les
 * transforme en titres, et on offre le même geste de retrait qu'au panier :
 * annoncer « des pièces ne sont plus disponibles » sans dire lesquelles
 * laisserait quelqu'un chercher à l'aveugle dans son propre bordereau.
 */
export function CheckoutErrorNotice({
  messageKey,
  articleIds,
  lines,
}: {
  messageKey: string
  articleIds?: readonly string[]
  /** Le panier courant, pour retrouver les titres des pièces nommées. */
  lines: readonly CartLineView[]
}) {
  const t = useTranslations('checkout.errors')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [messageKey, articleIds])

  const named = (articleIds ?? [])
    .map((articleId) => {
      const line = lines.find((entry) => entry.articleId === articleId)
      return line ? { articleId, title: line.title } : null
    })
    .filter((entry): entry is { articleId: string; title: string } =>
      Boolean(entry),
    )

  return (
    <div className="flex flex-col gap-4">
      <Notice
        ref={ref}
        tone="danger"
        role="alert"
        // `-1` et non `0` : le message doit pouvoir recevoir le focus par
        // programme, sans pour autant s'insérer dans l'ordre de tabulation.
        tabIndex={-1}
        className="outline-none"
      >
        <p className="text-ink">{t(messageKey)}</p>
      </Notice>

      {named.length > 0 ? <BlockedLinesNotice articles={named} /> : null}
    </div>
  )
}
