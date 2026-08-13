import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LEGAL, SITE, hasLegalIdentity } from '@/lib/config/site'
import { locales, localeTags } from '@/lib/i18n/routing'

/**
 * Pages éditoriales et légales.
 *
 * En Phase 1, seule la structure existe : les contenus juridiques complets
 * (CGV, confidentialité, cookies) sont rédigés en Phase 7, où ils font l'objet
 * d'un travail dédié.
 *
 * Règle tenue dès maintenant : aucune mention légale n'est inventée. Tant que
 * l'identité de l'entreprise n'est pas renseignée en variables
 * d'environnement, la page l'annonce clairement au lieu d'afficher un texte
 * plausible — un faux SIRET est pire que pas de SIRET.
 */

const SLUGS = [
  'mentions-legales',
  'cgv',
  'confidentialite',
  'cookies',
  'livraison',
  'retours',
  'a-propos',
] as const

type PageSlug = (typeof SLUGS)[number]

function isPageSlug(value: string): value is PageSlug {
  return (SLUGS as readonly string[]).includes(value)
}

type Params = Promise<{ locale: string; slug: string }>

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    SLUGS.map((slug) => ({ locale, slug })),
  )
}

const TITLE_KEY: Record<PageSlug, string> = {
  'mentions-legales': 'legalNotice',
  cgv: 'terms',
  confidentialite: 'privacy',
  cookies: 'cookies',
  livraison: 'shipping',
  retours: 'returns',
  'a-propos': 'about',
}

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { locale, slug } = await params
  if (!isPageSlug(slug)) return {}

  const t = await getTranslations({ locale, namespace: 'footer' })
  const languages = Object.fromEntries(
    locales.map((l) => [localeTags[l], `/${l}/pages/${slug}`]),
  )
  languages['x-default'] = `/fr/pages/${slug}`

  return {
    title: t(TITLE_KEY[slug]),
    alternates: { canonical: `/${locale}/pages/${slug}`, languages },
  }
}

export default async function StaticPage({ params }: { params: Params }) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  if (!isPageSlug(slug)) notFound()

  const t = await getTranslations('footer')
  const th = await getTranslations('home')

  return (
    <article className="mx-auto max-w-[46rem] px-4 py-12 sm:px-6">
      <h1 className="text-2xl">{t(TITLE_KEY[slug])}</h1>

      <div className="mt-6 flex flex-col gap-4 text-base text-ink">
        {slug === 'a-propos' ? (
          <>
            <p>{th('intro')}</p>
            <h2 className="mt-4 text-lg">{th('howItWorks.sourcingTitle')}</h2>
            <p className="text-muted">{th('howItWorks.sourcingBody')}</p>
            <h2 className="mt-4 text-lg">{th('howItWorks.selectionTitle')}</h2>
            <p className="text-muted">{th('howItWorks.selectionBody')}</p>
            <h2 className="mt-4 text-lg">{th('howItWorks.shippingTitle')}</h2>
            <p className="text-muted">{th('howItWorks.shippingBody')}</p>
          </>
        ) : null}

        {slug === 'mentions-legales' ? (
          hasLegalIdentity() ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted">Éditeur</dt>
              <dd>{LEGAL.companyName}</dd>
              <dt className="text-muted">SIRET</dt>
              <dd data-numeric>{LEGAL.siret}</dd>
              <dt className="text-muted">Adresse</dt>
              <dd>{LEGAL.address}</dd>
              <dt className="text-muted">Contact</dt>
              <dd>{LEGAL.email}</dd>
              <dt className="text-muted">TVA</dt>
              <dd>{LEGAL.vatExemptionNotice}</dd>
              {LEGAL.mediatorName ? (
                <>
                  <dt className="text-muted">{t('mediator')}</dt>
                  <dd>
                    {LEGAL.mediatorName}
                    {LEGAL.mediatorUrl ? ` — ${LEGAL.mediatorUrl}` : ''}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-muted">
              Les mentions légales seront publiées dès que l’identité de
              l’entreprise sera renseignée (LEGAL_COMPANY_NAME, LEGAL_SIRET,
              LEGAL_ADDRESS, LEGAL_EMAIL). Aucune valeur n’est inventée ici.
            </p>
          )
        ) : null}

        {slug === 'retours' ? (
          <>
            <p>{t('withdrawalNotice')}</p>
            <p className="text-muted">
              Le remboursement comprend les frais de livraison aller au tarif
              standard. Les frais de retour restent à la charge de l’acheteur,
              sauf article non conforme ou endommagé.
            </p>
          </>
        ) : null}

        {['cgv', 'confidentialite', 'cookies', 'livraison'].includes(slug) ? (
          <p className="rounded-card ruled bg-paper-raised p-4 text-muted">
            Contenu rédigé en Phase 7. La structure, les URL et les liens sont
            en place dès maintenant pour que le référencement et la navigation
            ne changent plus ensuite.
          </p>
        ) : null}
      </div>

      <p className="mt-10 text-xs text-muted">{SITE.name}</p>
    </article>
  )
}
