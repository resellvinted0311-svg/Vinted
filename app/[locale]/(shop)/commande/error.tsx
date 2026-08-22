'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'

/**
 * Frontière d'erreur du tunnel de commande.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi elle est obligatoire ici
 * ---------------------------------------------------------------------------
 * `prepareCheckout` peut lever : contrôle de somme, panne de Stripe, base
 * indisponible. L'action ne rattrape pas — c'est délibéré, une erreur avalée
 * en silence sur un chemin de paiement est pire qu'un écran d'erreur. Sans
 * cette frontière, le segment entier tomberait sur la page d'erreur générique
 * de l'application, hors de la boutique.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'elle n'écrit PAS
 * ---------------------------------------------------------------------------
 * « Rien n'a été débité. » On n'en sait rien : la frontière couvre aussi le
 * cadre de paiement, où un débit peut avoir eu lieu au moment précis où
 * l'écran s'est cassé. Promettre l'absence de débit, puis laisser arriver un
 * relevé bancaire, est la pire séquence possible.
 *
 * On dit donc ce qui est vrai : que la commande, si elle a été enregistrée,
 * se retrouve — et où.
 */
export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('checkout')

  useEffect(() => {
    // La console du serveur porte déjà la trace complète. Ici, l'empreinte
    // suffit à rapprocher un signalement d'une ligne de journal — et elle ne
    // contient aucune donnée personnelle.
    console.error('[commande]', error.digest ?? error.message)
  }, [error])

  return (
    <div className="mx-auto max-w-[36rem] px-4 pb-24 pt-16 sm:px-6">
      <h1 className="text-2xl">{t('errors.unexpectedTitle')}</h1>

      <Notice tone="danger" role="alert" className="mt-6">
        <p>{t('errors.unexpected')}</p>
      </Notice>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>{t('errors.retry')}</Button>
      </div>

      {error.digest ? (
        <p data-numeric className="data mt-6 text-xs text-muted">
          {t('errors.reference', { digest: error.digest })}
        </p>
      ) : null}
    </div>
  )
}
