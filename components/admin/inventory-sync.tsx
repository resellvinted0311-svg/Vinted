'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import {
  pullInventaireAction,
  type AdminSyncState,
} from '@/lib/admin/sync-actions'
import type { PullReport } from '@/lib/sync/pull'

/**
 * Synchroniser l'inventaire depuis la régie.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi la boucle est ICI et non sur le serveur
 * ---------------------------------------------------------------------------
 * Une fonction serverless a quelques dizaines de secondes ; le premier import
 * en demande une vingtaine de fois plus. Boucler côté serveur ferait tuer la
 * fonction en chemin — sans réponse, donc sans savoir ce qui a été écrit.
 *
 * Chaque appel fait donc une tranche et rend son compte. Le navigateur rappelle
 * tant qu'il reste des pièces, en affichant l'avancement. Fermer l'onglet
 * interrompt la boucle sans rien perdre : ce qui est écrit est écrit, et la
 * tâche planifiée — ou un nouveau clic — reprend là où on s'est arrêté.
 */

const INITIAL: AdminSyncState = { status: 'idle' }

export function InventorySync() {
  const t = useTranslations('admin.inventory')

  const [state, setState] = useState<AdminSyncState>(INITIAL)
  const [running, setRunning] = useState(false)
  const [cumul, setCumul] = useState({ examinees: 0, passages: 0 })

  /**
   * Le drapeau d'arrêt est une RÉFÉRENCE, pas un état.
   *
   * La boucle vit dans une fermeture créée au clic : une variable d'état lue
   * dedans garderait à jamais la valeur qu'elle avait à cet instant, et
   * « Arrêter » n'arrêterait rien. La référence, elle, est partagée.
   */
  const stop = useRef(false)

  const lancer = useCallback(async () => {
    stop.current = false
    setRunning(true)
    setCumul({ examinees: 0, passages: 0 })

    let examinees = 0
    let passages = 0

    for (;;) {
      const resultat = await pullInventaireAction()
      setState(resultat)

      if (resultat.status !== 'done') break

      examinees += resultat.report.examinees
      passages += 1
      setCumul({ examinees, passages })

      // Fini, ou arrêté à la main.
      if (resultat.report.reste === 0 || stop.current) break

      // Un passage qui n'examine RIEN alors qu'il reste des pièces ne peut que
      // se répéter : on s'arrête plutôt que de tourner sans fin.
      if (resultat.report.examinees === 0) break
    }

    setRunning(false)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {state.status === 'error' ? (
        <Notice tone="warning" role="alert">
          <p>
            {state.missing
              ? // Seules celles qui manquent VRAIMENT. Les nommer toutes les
                // trois faisait relire des variables déjà correctes.
                t('errors.notConfigured', { missing: state.missing.join(', ') })
              : t(`errors.${state.messageKey}`)}
          </p>
        </Notice>
      ) : null}

      {state.status === 'done' ? <Rapport report={state.report} /> : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="button"
          variant="primary"
          onClick={() => void lancer()}
          disabled={running}
        >
          {running ? t('running') : t('start')}
        </Button>

        {running ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stop.current = true
            }}
          >
            {t('stop')}
          </Button>
        ) : null}

        {cumul.passages > 0 ? (
          <p className="text-sm text-muted" aria-live="polite">
            {t('progress', {
              examined: cumul.examinees,
              passes: cumul.passages,
            })}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Rapport({ report }: { report: PullReport }) {
  const t = useTranslations('admin.inventory')

  // `reste` à zéro est la seule bonne nouvelle complète : tout le reste est un
  // état intermédiaire qu'un passage de plus fera avancer.
  const fini = report.reste === 0

  return (
    <Notice tone={fini ? 'success' : 'info'} role="status">
      <p>{fini ? t('finished') : t('partial', { remaining: report.reste })}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <Ligne libelle={t('read')} valeur={report.lues} />
        <Ligne libelle={t('created')} valeur={report.creees} />
        <Ligne libelle={t('updated')} valeur={report.misesAJour} />
        <Ligne libelle={t('unchanged')} valeur={report.inchangees} />
        <Ligne libelle={t('skipped')} valeur={report.ecartees} />
        <Ligne libelle={t('rejected')} valeur={report.refusees} />
        <Ligne libelle={t('failed')} valeur={report.echouees} />
      </dl>
    </Notice>
  )
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{libelle}</dt>
      <dd className="tabular-nums">{valeur}</dd>
    </div>
  )
}
