'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import type { ListingAction } from '@/lib/domain/article-listing'
import {
  listArticleAction,
  type ArticleActionState,
} from '@/lib/admin/article-actions'

/**
 * Mettre une pièce en vente, ou l'en retirer.
 *
 * ---------------------------------------------------------------------------
 * Les boutons viennent du SERVEUR, pas d'un `if` écrit ici
 * ---------------------------------------------------------------------------
 * `availableListingActions(...)` — le même domaine qui autorise la transition —
 * décide de ce qui s'affiche. Recopier ici « si brouillon alors publier »
 * dupliquerait la machine à états dans une vue, et les deux finiraient par
 * diverger : on verrait un bouton qui échoue, ou un geste possible que rien ne
 * propose.
 *
 * Le serveur refuse de toute façon ce qui n'est pas permis, et rejoue la
 * décision dans la transaction. Ce que ces boutons apportent est plus modeste :
 * ne pas faire cliquer pour rien.
 */

const INITIAL: ArticleActionState = { status: 'idle' }

export function ArticleListingForm({
  articleId,
  slug,
  actions,
  blockedReason,
}: {
  articleId: string
  slug: string
  /** Décidé serveur par `availableListingActions`. */
  actions: readonly ListingAction[]
  /** Pourquoi aucun geste n'est possible, si c'est le cas. */
  blockedReason?: string | undefined
}) {
  const t = useTranslations('admin.articles')
  const [state, formAction] = useActionState(listArticleAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="slug" value={slug} />

      {state.status === 'listed' ? (
        <Notice tone="success" role="status">
          <p>{t(`listed.${state.to}`)}</p>
          {/* Le nombre d'offres éteintes est DIT : retirer une pièce annule des
              négociations en cours, et l'apprendre après coup serait pire. */}
          {state.voidedOffers > 0 ? (
            <p>{t('voidedOffers', { count: state.voidedOffers })}</p>
          ) : null}
        </Notice>
      ) : null}

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`errors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      {actions.length === 0 && blockedReason ? (
        <p className="text-xs text-muted">{t(`errors.${blockedReason}`)}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <SubmitButton
            key={action}
            action={action}
            label={t(action)}
            variant={action === 'publish' ? 'primary' : 'outline'}
          />
        ))}
      </div>
    </form>
  )
}

/**
 * `useFormStatus` doit être lu par un composant ENFANT du formulaire. Ici, deux
 * clics sur « Publier » ne publieraient pas deux fois — la transition est
 * conditionnelle en base — mais afficheraient un refus au lieu du succès.
 */
function SubmitButton({
  action,
  label,
  variant,
}: {
  action: ListingAction
  label: string
  variant: 'primary' | 'outline'
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      name="action"
      value={action}
      variant={variant}
      size="sm"
      disabled={pending}
    >
      {label}
    </Button>
  )
}
