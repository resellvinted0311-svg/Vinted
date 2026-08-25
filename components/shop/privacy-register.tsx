import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import {
  PROCESSING_REGISTER,
  activeProcessors,
  type Processing,
} from '@/lib/config/privacy'
import { LEGAL, hasLegalIdentity } from '@/lib/config/site'

/**
 * Politique de confidentialité, rendue depuis le registre.
 *
 * Rien n'est écrit ici : durées, bases légales et prestataires viennent de
 * `lib/config/privacy.ts`, qui est aussi ce qu'applique la purge périodique.
 * Un texte rédigé à la main aurait dérivé du code en quelques semaines — et
 * une politique de confidentialité fausse engage plus qu'elle ne protège.
 *
 * L'identité du responsable suit la même règle que les mentions légales :
 * tant qu'elle n'est pas renseignée, on le dit, on ne l'invente pas.
 */

/**
 * Une durée en jours, dite comme on la dit à l'oral.
 *
 * Dérivée du registre, jamais saisie à part : « 3650 jours » et « dix ans »
 * doivent rester le même fait, sans possibilité de les faire diverger.
 */
function retentionLabel(
  processing: Processing,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (processing.retentionDays === null) return t('retentionWhileAccount')
  // Fixée chez le prestataire, pas ici. Le dire vaut mieux qu'annoncer un
  // nombre de jours que la purge de ce site n'applique pas.
  if (processing.retentionDays === 'external') return t('retentionExternal')
  if (processing.retentionDays < 365) {
    return t('retentionDays', { days: processing.retentionDays })
  }
  return t('retentionYears', { years: Math.round(processing.retentionDays / 365) })
}

export async function PrivacyRegister({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'privacy' })
  const processors = activeProcessors()

  return (
    <>
      <p>{t('intro')}</p>

      <h2 className="mt-8 text-lg">{t('controller')}</h2>
      {hasLegalIdentity() ? (
        <p className="text-muted">
          {LEGAL.companyName} — {LEGAL.address} — {LEGAL.email}
        </p>
      ) : (
        <p className="rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-muted">
          {t('controllerMissing')}
        </p>
      )}

      <h2 className="mt-8 text-lg">{t('purposes')}</h2>
      {/* La table déborde sur un téléphone : elle défile dans son propre
          conteneur plutôt que d'emporter la page entière. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-[1.5px] border-rule">
              <th className="label-reg py-2 pr-4 font-normal text-muted">
                {t('table.purpose')}
              </th>
              <th className="label-reg py-2 pr-4 font-normal text-muted">
                {t('table.basis')}
              </th>
              <th className="label-reg py-2 font-normal text-muted">
                {t('table.retention')}
              </th>
            </tr>
          </thead>
          <tbody>
            {PROCESSING_REGISTER.map((processing) => (
              <tr key={processing.key} className="border-b border-sand">
                <td className="py-2 pr-4 text-ink">
                  {t(`processing.${processing.key}`)}
                </td>
                <td className="py-2 pr-4 text-muted">
                  {t(`basis.${processing.basis}`)}
                </td>
                <td className="data py-2 text-muted">
                  {retentionLabel(processing, t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg">{t('processors')}</h2>
      <p className="text-muted">{t('processorsIntro')}</p>
      <ul className="flex flex-col gap-1">
        {processors.map((processor) => (
          <li key={processor.key} className="text-muted">
            <span className="text-ink">{processor.name}</span> —{' '}
            {t(`region.${processor.region}`)}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg">{t('rights')}</h2>
      <p className="text-muted">{t('rightsIntro')}</p>
      <p>
        <Link href="/compte" className="underline underline-offset-4">
          {t('rightsLink')}
        </Link>
      </p>

      {/*
        Le paiement sans compte est autorisé : quelqu'un peut donc avoir laissé
        une adresse postale ici sans jamais avoir eu d'espace personnel. Lui
        annoncer que ses droits s'exercent « depuis votre espace personnel »
        le laisse sans voie du tout. On dit la voie qui existe réellement.

        Aucune adresse de contact n'est écrite ici : elle vient des mentions
        légales, alimentées par la configuration. Rien n'est inventé.
      */}
      <p className="text-muted">
        {t('rightsNoAccount')}{' '}
        <Link
          href="/pages/mentions-legales"
          className="underline underline-offset-4"
        >
          {t('rightsNoAccountLink')}
        </Link>
      </p>

      <p className="text-muted">{t('complaint')}</p>
    </>
  )
}
