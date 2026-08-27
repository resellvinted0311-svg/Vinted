'use client'

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import {
  reorderImageAction,
  type ArticleActionState,
} from '@/lib/admin/article-actions'

/**
 * Les photos d'une pièce : ajouter, déplacer, retirer.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi le téléversement passe par `fetch` et non par une action serveur
 * ---------------------------------------------------------------------------
 * Les Server Actions plafonnent le corps de la requête à un mégaoctet, et ce
 * plafond est GLOBAL au site : le relever pour une photo de téléphone le
 * relèverait aussi pour le panier et le tunnel de commande. Le fichier part
 * donc vers une route dédiée, qui porte sa propre limite.
 *
 * ---------------------------------------------------------------------------
 * Le fichier est envoyé TEL QUEL, sans passage par un canvas
 * ---------------------------------------------------------------------------
 * La tentation serait de réduire l'image dans le navigateur pour économiser de
 * la bande passante. Ce serait un piège : un passage par canvas supprime la
 * balise EXIF d'orientation, et c'est elle qui permet au serveur de redresser
 * une photo prise à la verticale. Le serveur recevrait une image couchée et
 * sans balise — donc plus rien ne pourrait la corriger, et toutes les photos de
 * téléphone partiraient de travers.
 *
 * Le ré-encodage a lieu côté serveur, où l'orientation est lue AVANT d'être
 * effacée.
 *
 * ---------------------------------------------------------------------------
 * La première photo est la VIGNETTE
 * ---------------------------------------------------------------------------
 * C'est ce que le catalogue affiche. D'où les flèches : sans elles, une
 * boutiquière qui téléverse d'abord la photo de l'étiquette n'aurait aucun
 * recours.
 */

const INITIAL: ArticleActionState = { status: 'idle' }

/** Ce que la route accepte. Le serveur revérifie par les octets d'en-tête. */
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/avif'

export function ArticleImages({
  articleId,
  slug,
  images,
  maxImages,
}: {
  articleId: string
  slug: string
  images: readonly { id: string; url: string; position: number }[]
  maxImages: number
}) {
  const t = useTranslations('admin.articles')
  const router = useRouter()

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, startUploading] = useTransition()

  async function upload(file: File): Promise<void> {
    setUploadError(null)

    const body = new FormData()
    body.set('image', file)

    const response = await fetch(`/api/admin/articles/${articleId}/images`, {
      method: 'POST',
      body,
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      // Le motif est rendu à l'écran : « refusé » sans raison laisse rééssayer
      // la même photo indéfiniment.
      setUploadError(payload?.error ?? 'unknown')
      return
    }

    // La liste vient du serveur : on la relit plutôt que d'ajouter la ligne à
    // la main. Une vue locale qui diverge de la base, c'est une position qui
    // n'est pas celle qu'on croit.
    router.refresh()
  }

  const full = images.length >= maxImages

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg">{t('photos')}</h2>
        <span className="text-xs text-muted">
          {t('photoCount', { count: images.length, max: maxImages })}
        </span>
      </div>

      {images.length === 0 ? (
        <Notice tone="warning" role="status">
          {/* Sans photo, la mise en vente est refusée : une fiche sans visuel
              est une vignette vide au catalogue. */}
          <p>{t('noPhotoYet')}</p>
        </Notice>
      ) : null}

      {uploadError ? (
        <Notice tone="warning" role="alert">
          <p>{t(`uploadErrors.${uploadError}`)}</p>
        </Notice>
      ) : null}

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {images.map((image, index) => (
          <li key={image.id} className="flex flex-col gap-2">
            {/* `img` et non `next/image` : l'URL vient de l'hébergeur et la
                vignette de régie n'a pas besoin d'être optimisée. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={t('photoAlt', { position: index + 1 })}
              className="aspect-square w-full rounded object-cover"
              loading="lazy"
            />

            {index === 0 ? (
              <span className="text-xs uppercase tracking-wide text-muted">
                {t('thumbnail')}
              </span>
            ) : null}

            <ImageControls
              imageId={image.id}
              slug={slug}
              canMoveUp={index > 0}
              canMoveDown={index < images.length - 1}
            />
          </li>
        ))}
      </ul>

      <div>
        <label className="flex flex-col gap-1.5">
          <span className="label-reg text-ink">{t('addPhoto')}</span>
          <input
            type="file"
            accept={ACCEPTED}
            disabled={full || uploading}
            className="text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Le champ est remis à zéro : sans cela, redéposer le MÊME
              // fichier après un refus ne déclencherait aucun événement.
              event.target.value = ''
              if (file) startUploading(() => void upload(file))
            }}
          />
        </label>
        {full ? <p className="mt-1 text-xs text-muted">{t('photosFull')}</p> : null}
      </div>
    </div>
  )
}

function ImageControls({
  imageId,
  slug,
  canMoveUp,
  canMoveDown,
}: {
  imageId: string
  slug: string
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const t = useTranslations('admin.articles')
  const [state, formAction] = useActionState(reorderImageAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-wrap gap-1">
      <input type="hidden" name="imageId" value={imageId} />
      <input type="hidden" name="slug" value={slug} />

      <Button type="submit" name="action" value="up" variant="outline" size="sm" disabled={!canMoveUp}>
        {t('moveUp')}
      </Button>
      <Button type="submit" name="action" value="down" variant="outline" size="sm" disabled={!canMoveDown}>
        {t('moveDown')}
      </Button>
      <Button type="submit" name="action" value="remove" variant="outline" size="sm">
        {t('removePhoto')}
      </Button>

      {state.status === 'error' ? (
        <span role="alert" className="text-xs text-danger">
          {t(`errors.${state.messageKey}`)}
        </span>
      ) : null}
    </form>
  )
}
