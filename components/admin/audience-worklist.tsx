'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { ARTICLE_AUDIENCES } from '@/lib/domain/vocabulary'
import type { UnqualifiedArticleRow } from '@/lib/db/queries/admin-audiences'
import {
  qualifyAudienceAction,
  type AudienceActionState,
} from '@/lib/admin/audience-actions'

/**
 * La liste de travail : cocher des pièces, leur poser un univers.
 *
 * ---------------------------------------------------------------------------
 * Trois boutons d'envoi, pas un menu suivi d'un bouton
 * ---------------------------------------------------------------------------
 * Le geste réel est « ces pièces-là sont des pièces femme ». Le faire en deux
 * temps — choisir dans une liste déroulante, puis valider — ajoute un état à
 * retenir entre deux lots, et c'est précisément là que l'erreur se glisse : on
 * coche vingt pièces homme en oubliant que le menu est resté sur « femme ».
 *
 * Chaque bouton porte donc sa valeur en `name`/`value` : ce qui part est ce
 * qu'on vient de cliquer, sans mémoire.
 *
 * ---------------------------------------------------------------------------
 * La sélection est tenue ICI, et pas seulement par le navigateur
 * ---------------------------------------------------------------------------
 * Il faut savoir combien de pièces sont cochées pour l'écrire sur les boutons —
 * un envoi vide est refusé par le serveur, et faire cliquer pour se voir
 * refuser est un mauvais écran. L'état porte donc les identifiants cochés.
 *
 * Après un envoi réussi, la sélection est VIDÉE. Sans cela, les cases restent
 * cochées sur des pièces qui viennent de quitter la liste au rechargement, et
 * le lot suivant repart avec elles.
 */

const INITIAL: AudienceActionState = { status: 'idle' }

export function AudienceWorklist({
  articles,
}: {
  articles: readonly UnqualifiedArticleRow[]
}) {
  const t = useTranslations('admin.audiences')
  const tc = useTranslations('catalogue')
  const [state, formAction] = useActionState(qualifyAudienceAction, INITIAL)
  const [selected, setSelected] = useState<readonly string[]>([])

  // L'état d'envoi précédent porte encore l'ancienne sélection quand le
  // serveur a répondu : on la vide au premier rendu qui suit un succès.
  const [lastHandled, setLastHandled] = useState<AudienceActionState>(INITIAL)
  if (state !== lastHandled) {
    setLastHandled(state)
    if (state.status === 'qualified' && selected.length > 0) setSelected([])
  }

  const basculer = (id: string, coche: boolean) => {
    setSelected((courant) =>
      coche ? [...courant, id] : courant.filter((autre) => autre !== id),
    )
  }

  const toutCocher = () => {
    setSelected(
      selected.length === articles.length ? [] : articles.map((a) => a.id),
    )
  }

  return (
    <form action={formAction} className="mt-6">
      {state.status === 'qualified' ? (
        <Notice tone="success" role="status">
          <p>{t('done', { count: state.updated })}</p>
          {/*
            L'écart entre demandé et écrit est DIT, pas masqué. Il se produit
            quand une pièce a été qualifiée entre-temps — depuis un autre
            onglet, ou par un double-clic — et le taire apprendrait à ne plus
            croire les comptes rendus.
          */}
          {state.updated < state.requested ? (
            <p>{t('alreadyDone', { count: state.requested - state.updated })}</p>
          ) : null}
        </Notice>
      ) : null}

      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>{t(`errors.${state.messageKey}`)}</p>
        </Notice>
      ) : null}

      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b-[1.5px] border-rule bg-paper px-4 py-3">
        <button
          type="button"
          onClick={toutCocher}
          className="label-reg text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {selected.length === articles.length ? t('selectNone') : t('selectAll')}
        </button>

        <p aria-live="polite" className="text-xs text-muted" data-numeric>
          {t('selectedCount', { count: selected.length })}
        </p>

        <div className="ml-auto flex flex-wrap gap-2">
          {ARTICLE_AUDIENCES.map((audience) => (
            <SubmitButton
              key={audience}
              audience={audience}
              label={tc(`audiences.${audience}`)}
              disabled={selected.length === 0}
            />
          ))}
        </div>
      </div>

      <ul className="divide-y divide-sand border-b-[1.5px] border-rule">
        {articles.map((article) => {
          const coche = selected.includes(article.id)
          return (
            <li key={article.id}>
              {/*
                Toute la ligne est cliquable parce que le `label` enveloppe la
                case ET le contenu : viser une case de seize pixels mille fois
                de suite est le genre de détail qui décide si ce travail se
                fait ou s'abandonne.
              */}
              <label className="flex cursor-pointer items-center gap-4 py-3 hover:bg-surface">
                <input
                  type="checkbox"
                  name="articleIds"
                  value={article.id}
                  checked={coche}
                  onChange={(event) => basculer(article.id, event.target.checked)}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />

                {article.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={article.thumbnailUrl}
                    alt=""
                    className="size-14 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="flex size-14 shrink-0 items-center justify-center rounded border border-dashed border-rule text-[10px] text-muted"
                    aria-hidden
                  >
                    {t('noPhoto')}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base text-ink">
                    {article.title}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span data-numeric>{article.sku}</span>
                    <span>{article.categoryName}</span>
                    {/*
                      L'origine est montrée sans être un obstacle : une pièce
                      importée se qualifie exactement comme les autres, parce
                      que la synchronisation n'écrit jamais ce champ.
                    */}
                    {article.imported ? <span>{t('imported')}</span> : null}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </form>
  )
}

/** `useFormStatus` ne se lit que dans un ENFANT du formulaire. */
function SubmitButton({
  audience,
  label,
  disabled,
}: {
  audience: string
  label: string
  disabled: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      name="audience"
      value={audience}
      variant="outline"
      size="sm"
      disabled={disabled || pending}
    >
      {label}
    </Button>
  )
}
