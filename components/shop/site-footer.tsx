import { getTranslations } from 'next-intl/server'
import { Link } from '@/lib/i18n/navigation'
import { SITE, LEGAL } from '@/lib/config/site'

export async function SiteFooter() {
  const t = await getTranslations('footer')

  const legalLinks = [
    { href: '/pages/mentions-legales', label: t('legalNotice') },
    { href: '/pages/cgv', label: t('terms') },
    { href: '/pages/confidentialite', label: t('privacy') },
    { href: '/pages/cookies', label: t('cookies') },
  ] as const

  const shopLinks = [
    { href: '/pages/livraison', label: t('shipping') },
    { href: '/pages/retours', label: t('returns') },
    { href: '/pages/a-propos', label: t('about') },
    { href: '/contact', label: t('contact') },
  ] as const

  return (
    // Colophon : la mention de fin d'un ouvrage imprimé, qui dit qui l'a
    // composé et sous quelles règles. C'est exactement ce que contient ce pied
    // de page — d'où le traitement en bloc réglé plutôt qu'en bandeau coloré.
    <footer className="mt-20 ruled-t bg-paper-raised">
      <div className="mx-auto max-w-[80rem] px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-display text-lg font-bold uppercase tracking-tight text-ink">
              {SITE.name}
            </p>
            <span
              aria-hidden
              className="mt-2 block h-[1.5px] w-10 bg-rule"
            />
            <p className="data mt-2 text-xs text-muted">
              {LEGAL.companyName || null}
            </p>
          </div>

          <nav aria-label={t('about')}>
            <ul className="flex flex-col gap-2">
              {shopLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="label-reg text-muted transition-colors duration-150 ease-out hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t('legalNotice')}>
            <ul className="flex flex-col gap-2">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="label-reg text-muted transition-colors duration-150 ease-out hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="data mt-8 flex flex-col gap-1 border-t border-sand pt-6 text-xs text-muted">
          <p>{t('withdrawalNotice')}</p>

          {/* Mention obligatoire en franchise en base de TVA. */}
          {LEGAL.vatExempt ? <p>{t('vatNotice')}</p> : null}

          {/* Médiateur : obligatoire pour tout e-commerce B2C français.
              Rien n'est affiché tant que les coordonnées ne sont pas
              renseignées — mieux vaut un vide qu'un nom inventé. */}
          {LEGAL.mediatorName ? (
            <p>
              {t('mediator')} : {LEGAL.mediatorName}
              {LEGAL.mediatorUrl ? (
                <>
                  {' — '}
                  <a
                    href={LEGAL.mediatorUrl}
                    className="underline underline-offset-2"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {LEGAL.mediatorUrl}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          {LEGAL.siret ? <p>SIRET {LEGAL.siret}</p> : null}
        </div>
      </div>
    </footer>
  )
}
