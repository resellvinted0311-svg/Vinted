import { useTranslations, useLocale } from 'next-intl'

import { Link } from '@/lib/i18n/navigation'
import { ArticleImage } from '@/components/shop/article-image'
import { formatPrice, formatDate } from '@/lib/utils/format'
import type { OfferRegisterEntry } from '@/lib/db/queries/offers'
import { OfferStandingBadge } from './offer-standing-badge'
import { CounterAnswerForm } from './counter-answer-form'

/**
 * Une ligne du registre des offres.
 *
 * ---------------------------------------------------------------------------
 * Ce que la ligne DOIT dire, et qui n'est pas le montant
 * ---------------------------------------------------------------------------
 * Une offre n'a jamais mis la pièce de côté — la page le dit une fois, en
 * introduction, et la ligne ne le répète pas : les états qui appellent un geste
 * passent en tête, donc le rappel est toujours à deux lignes au-dessus d'eux.
 *
 * Ce que la ligne ajoute, c'est la conséquence datée. Trois états en portent
 * une, et chacun mérite sa phrase plutôt qu'une étiquette seule :
 *
 *  - « payable » vient avec une échéance. C'est la promesse faite par e-mail,
 *    et c'est la seule ligne où il reste quelque chose à faire ;
 *  - « sans objet » veut dire que la pièce est partie pendant la négociation.
 *    Sans cette phrase, la personne lirait un refus là où il n'y en a pas eu ;
 *  - « en attente » porte la date avant laquelle une réponse est due, parce
 *    qu'une attente sans terme n'est pas une attente.
 *
 * ---------------------------------------------------------------------------
 * Le prix affiché est rappelé, et barré quand l'offre est payable
 * ---------------------------------------------------------------------------
 * C'est le même traitement que dans le panier, et pour la même raison : un
 * montant négocié seul ne dit rien de ce qu'il fait gagner, et la personne
 * n'a pas à rouvrir la fiche pour le savoir.
 */
export function OfferRegisterRow({ offer }: { offer: OfferRegisterEntry }) {
  const t = useTranslations('offers')
  const locale = useLocale()

  const { standing, article } = offer
  const payable = standing === 'payable'

  return (
    <li className="flex gap-4 py-4">
      <Link
        href={`/a/${article.slug}`}
        className="relative block h-20 w-16 shrink-0 overflow-hidden rounded-input bg-paper-raised"
        // La vignette double le lien du titre : elle n'apporte rien à qui
        // navigue au clavier ou à l'oreille, et l'annoncer deux fois ferait
        // lire deux fois la même destination.
        tabIndex={-1}
        aria-hidden="true"
      >
        {article.image ? (
          <ArticleImage image={article.image} sizes="64px" />
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link
            href={`/a/${article.slug}`}
            className="text-base text-ink underline-offset-4 hover:underline"
          >
            {article.title}
          </Link>
          <span className="data text-xs text-muted">{article.sku}</span>
        </div>

        <p className="text-sm text-ink">
          {/*
            Qui a proposé ce montant. La contre-proposition de la boutique
            porte la même identité que l'offre de l'acheteuse — c'est ce qui
            lui permet de la voir — et rien d'autre ne les distinguerait.
          */}
          {offer.fromShop
            ? t('shopCountered', {
                amount: formatPrice(offer.amountCents, locale),
              })
            : t('youOffered', {
                amount: formatPrice(offer.amountCents, locale),
              })}
          {' · '}
          <span
            data-numeric
            className={payable ? 'text-muted line-through' : 'text-muted'}
          >
            {t('listedPrice', {
              amount: formatPrice(article.priceCents, locale),
            })}
          </span>
        </p>

        <p className="text-xs text-muted">
          {standing === 'payable' && offer.priceValidUntil
            ? t('payableUntil', {
                date: formatDate(offer.priceValidUntil, locale),
              })
            : null}

          {standing === 'awaiting'
            ? t('answerDueBy', { date: formatDate(offer.expiresAt, locale) })
            : null}

          {standing === 'countered'
            ? t('answerDueBy', { date: formatDate(offer.expiresAt, locale) })
            : null}

          {standing === 'lapsed' ? t('lapsedHint') : null}
          {standing === 'void' ? t('voidHint') : null}
          {standing === 'rejected' ? t('rejectedHint') : null}
          {standing === 'expired' ? t('expiredHint') : null}
          {standing === 'used' ? t('usedHint') : null}
        </p>

        {/*
          Le geste est sur la ligne de la CONTRE-PROPOSITION, pas sur l'offre
          d'origine. Les deux coexistent dans le registre : la première porte
          désormais « countered » et raconte ce qui s'est passé, la seconde est
          « awaiting » et attend une réponse. Mettre les boutons sur la
          première — le réflexe, puisque c'est elle qui porte l'état
          « contre-proposée » — les poserait sur une ligne close.

          `canAnswer` est dérivé serveur par `buyerMayAnswer` : la vue ne
          rejuge rien, sans quoi l'affichage et le serveur finiraient par
          diverger.
        */}
        {offer.canAnswer ? <CounterAnswerForm counterOfferId={offer.id} /> : null}
      </div>

      <div className="flex shrink-0 items-start">
        <OfferStandingBadge standing={standing} />
      </div>
    </li>
  )
}
