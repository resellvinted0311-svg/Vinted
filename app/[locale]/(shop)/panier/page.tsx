import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { readCart } from '@/lib/shop/cart'
import { tallyCart, canOpenCheckout, isPurchasable } from '@/lib/domain/cart'
import { CartLineRow } from '@/components/shop/cart-line-row'
import { CartRemoveButton } from '@/components/shop/cart-remove-button'
import { BlockedLinesNotice } from '@/components/shop/blocked-lines-notice'
import { TotalsSheet } from '@/components/shop/totals-sheet'

/** Dépend de la session boutique : jamais mis en cache. */
export const dynamic = 'force-dynamic'

/**
 * Pourquoi le tunnel a renvoyé ici.
 *
 * `role="status"` : le renvoi vient d'être provoqué par un geste — appuyer sur
 * « Passer commande » — et personne ne doit avoir à deviner pourquoi la page a
 * changé. Une redirection silencieuse est la même faute qu'un retrait
 * silencieux.
 */
async function ReturnNotice({ reason }: { reason: ReturnReason }) {
  const t = await getTranslations('cart.returnReason')

  return (
    <Notice tone="warning" role="status" className="mt-6">
      <p>{t(reason)}</p>
    </Notice>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'cart' })
  // Le `noindex` est aussi posé par le middleware, en en-tête HTTP. Les deux :
  // l'un couvre la page rendue, l'autre couvre tout ce qui passe par là.
  return { title: t('title'), robots: { index: false, follow: false } }
}

/**
 * Le bordereau.
 *
 * ---------------------------------------------------------------------------
 * On constate ici, on décide ici, on ne paie pas ici
 * ---------------------------------------------------------------------------
 * C'est la seule page qui retire des lignes. Le tunnel, lui, n'en retire
 * aucune : `prepareCheckoutFor` refuse le panier ENTIER dès qu'une pièce n'est
 * plus payable, donc « panier sain » est une condition d'ENTRÉE dans le
 * paiement, pas une erreur à rattraper au milieu d'un formulaire d'adresse.
 *
 * ---------------------------------------------------------------------------
 * Aucun port n'est annoncé
 * ---------------------------------------------------------------------------
 * Il dépend de la destination, et personne n'a encore dit où livrer. Une
 * estimation ici serait un chiffre qui change ensuite — c'est exactement ce
 * qui fait abandonner un panier, et c'est de l'information trompeuse.
 */
/**
 * Motifs de renvoi depuis le tunnel, énumérés ici et nulle part ailleurs.
 *
 * Un paramètre d'URL vient du réseau : n'importe qui peut écrire
 * `?renvoi=nimportequoi`. On ne le passe donc jamais tel quel à `t()` — ce
 * serait afficher une clé de traduction brute, ou pire, laisser choisir quel
 * message la boutique affiche.
 */
const RETURN_REASONS = ['panier-vide', 'lignes-bloquees'] as const
type ReturnReason = (typeof RETURN_REASONS)[number]

function readReturnReason(value: string | undefined): ReturnReason | null {
  return RETURN_REASONS.includes(value as ReturnReason)
    ? (value as ReturnReason)
    : null
}

export default async function CartPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ renvoi?: string }>
}) {
  const { locale } = await params
  const { renvoi } = await searchParams
  setRequestLocale(locale)

  const t = await getTranslations('cart')
  const reason = readReturnReason(renvoi)
  const cart = await readCart(locale)
  const tally = tallyCart(cart.lines)

  const blocked = cart.lines
    .filter((line) => !isPurchasable(line.state))
    .map((line) => ({ articleId: line.articleId, title: line.title }))

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-[48rem] px-4 pb-24 pt-12 sm:px-6">
        <h1 className="text-2xl">{t('title')}</h1>
        {reason ? <ReturnNotice reason={reason} /> : null}
        <div className="mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('empty')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyHint')}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/catalogue">{t('continueShopping')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[64rem] px-4 pb-24 pt-12 sm:px-6">
      <h1 className="text-2xl">{t('title')}</h1>
      <p data-numeric className="mt-1 text-xs text-muted">
        {t('count', { count: tally.total })}
      </p>

      {reason ? <ReturnNotice reason={reason} /> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div>
          {blocked.length > 0 ? (
            <div className="mb-6">
              <BlockedLinesNotice articles={blocked} />
            </div>
          ) : null}

          <ul className="divide-y divide-sand border-y-[1.5px] border-rule">
            {cart.lines.map((line, index) => (
              <CartLineRow key={line.cartItemId} line={line} index={index + 1}>
                <CartRemoveButton
                  articleId={line.articleId}
                  title={line.title}
                />
              </CartLineRow>
            ))}
          </ul>
        </div>

        <aside className="rounded-card ruled bg-surface p-5 lg:sticky lg:top-6">
          <h2 className="label-reg text-ink">{t('summary')}</h2>

          {/*
            Le sous-total ne compte QUE les lignes payables. Quand les deux
            décomptes diffèrent, on le dit : sinon le total paraît faux.
          */}
          {tally.blocked > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {t('subtotalScope', {
                purchasable: tally.purchasable,
                blocked: tally.blocked,
              })}
            </p>
          ) : null}

          <TotalsSheet
            className="mt-4"
            subtotalCents={tally.subtotalCents}
            shippingCents={null}
          />

          <div className="mt-6 flex flex-col gap-3">
            {canOpenCheckout(tally) ? (
              <Button asChild size="lg" fullWidth>
                <Link href="/commande">{t('openOrder')}</Link>
              </Button>
            ) : (
              <>
                {/*
                  Le bouton est éteint, et la raison est juste au-dessus, dans
                  le même encart : un bouton désactivé sans motif visible est
                  une impasse. Le geste de sortie — retirer les lignes — est
                  dans l'encart d'alerte, nommé pièce par pièce.
                */}
                <Button size="lg" fullWidth disabled>
                  {t('openOrder')}
                </Button>
                <p className="text-xs text-muted">
                  {tally.purchasable === 0
                    ? t('openOrderNothingPayable')
                    : t('openOrderBlocked', { count: tally.blocked })}
                </p>
              </>
            )}

            <Button asChild variant="ghost" size="sm" fullWidth>
              <Link href="/catalogue">{t('continueShopping')}</Link>
            </Button>
          </div>

          <Notice tone="neutral" className="mt-6 bg-transparent p-0">
            <p className="text-xs">{t('shippingAtNextStep')}</p>
          </Notice>
        </aside>
      </div>
    </div>
  )
}
