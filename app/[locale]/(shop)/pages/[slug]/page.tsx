import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LEGAL, SITE, hasLegalIdentity, hasMediator } from '@/lib/config/site'
import { isPlaceholderPage } from '@/lib/config/pages'
import { locales, localeTags } from '@/lib/i18n/routing'
import { PrivacyRegister } from '@/components/shop/privacy-register'

/**
 * Pages éditoriales et légales.
 *
 * La page de confidentialité fait exception : elle est rendue depuis le
 * registre des traitements (`lib/config/privacy.ts`), donc elle est exacte dès
 * maintenant — le site collecte des adresses e-mail aujourd'hui, il doit dire
 * aujourd'hui ce qu'il en fait. Les CGV et la page cookies restent en Phase 7.
 *
 * Règle tenue dès maintenant : aucune mention légale n'est inventée. Tant que
 * l'identité de l'entreprise n'est pas renseignée en variables
 * d'environnement, la page l'annonce clairement au lieu d'afficher un texte
 * plausible — un faux SIRET est pire que pas de SIRET.
 */

/*
  `contact` est arrivé ici, et non sous `/contact`.

  Le pied de page annonçait « Contact » vers `/contact` depuis le premier jour.
  La route n'a jamais existé : le lien tombait en 404, dans les huit langues, à
  chaque page du site. C'est le lien le plus visible du colophon, et c'est
  aussi celui que la page de confidentialité et le formulaire de rétractation
  désignent implicitement comme la voie pour écrire à la boutique.

  Le rattacher à cette route plutôt que d'en créer une nouvelle donne
  gratuitement ce qu'elle porte déjà : URL canonique, hreflang sur les huit
  langues, prérendu, et surtout la même règle qu'ailleurs — aucune coordonnée
  n'est inventée tant que l'identité de l'entreprise n'est pas renseignée.

  Aucune adresse n'est perdue au passage, puisque `/contact` ne répondait pas.
*/
const SLUGS = [
  'mentions-legales',
  'cgv',
  'confidentialite',
  'cookies',
  'livraison',
  'retours',
  'contact',
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
  contact: 'contact',
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
    <article className="mx-auto max-w-[46rem] px-4 pb-24 pt-12 sm:px-6">
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
              {/* Le médiateur est TOUJOURS affiché, y compris absent.
                  L'omettre en silence laissait publier des mentions légales
                  présentées comme complètes alors qu'il leur manquait un
                  élément obligatoire (article L612-1 du code de la
                  consommation). */}
              <dt className="text-muted">{t('mediator')}</dt>
              <dd>
                {hasMediator() ? (
                  <>
                    {LEGAL.mediatorName}
                    {LEGAL.mediatorUrl ? ` — ${LEGAL.mediatorUrl}` : ''}
                  </>
                ) : (
                  <span className="text-warning">
                    Adhésion à un médiateur de la consommation non encore
                    renseignée. Elle est obligatoire avant toute vente.
                  </span>
                )}
              </dd>
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

            {/* Le formulaire type doit être MIS À DISPOSITION, pas seulement
                mentionné : c'est ce que dit l'annexe de l'article L221-5 du
                code de la consommation. La page citait le droit sans jamais
                fournir l'instrument qui permet de l'exercer.

                Il n'est rendu que si l'identité de l'entreprise est connue :
                un formulaire adressé à personne ne sert à rien, et inventer
                un destinataire serait pire. */}
            <h2 className="mt-6 text-lg">{t('withdrawalFormTitle')}</h2>
            <p className="text-muted">{t('withdrawalFormIntro')}</p>

            {hasLegalIdentity() ? (
              <div className="rounded-card ruled bg-paper-raised p-5 text-sm">
                <p className="text-xs text-muted">
                  {t('withdrawalFormLanguage')}
                </p>

                <p className="mt-4">
                  À l’attention de {LEGAL.companyName}, {LEGAL.address},{' '}
                  {LEGAL.email} :
                </p>

                <p className="mt-4">
                  Je vous notifie par la présente ma rétractation du contrat
                  portant sur la vente du bien ci-dessous :
                </p>

                <ul className="mt-4 flex list-none flex-col gap-2 text-muted">
                  <li>— Commandé le : ……………………</li>
                  <li>— Reçu le : ……………………</li>
                  <li>— Numéro de commande : ……………………</li>
                  <li>— Nom du consommateur : ……………………</li>
                  <li>— Adresse du consommateur : ……………………</li>
                  <li>— Date : ……………………</li>
                  <li>
                    — Signature (uniquement en cas de notification sur papier) :
                    ……………………
                  </li>
                </ul>
              </div>
            ) : (
              <p className="rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-muted">
                Le formulaire sera publié dès que l’identité de l’entreprise
                sera renseignée : il doit porter le nom et l’adresse exacts du
                destinataire, qui ne s’inventent pas.
              </p>
            )}
          </>
        ) : null}

        {slug === 'contact' ? (
          hasLegalIdentity() ? (
            <>
              <p>{t('contactIntro')}</p>

              {/* `<address>` porte la sémantique attendue : ce bloc EST les
                  coordonnées de l'éditeur, pas un paragraphe qui en parle.
                  Le lien `mailto:` évite la recopie à la main — c'est
                  exactement la même adresse que celle des mentions légales et
                  du formulaire de rétractation, jamais une seconde. */}
              <address className="not-italic">
                <span className="text-muted">{t('contactEmailLabel')}</span>
                <br />
                <a
                  href={`mailto:${LEGAL.email}`}
                  className="underline underline-offset-4"
                >
                  {LEGAL.email}
                </a>
                <br />
                <br />
                <span className="text-muted">{t('contactAddressLabel')}</span>
                <br />
                {LEGAL.companyName}
                <br />
                {LEGAL.address}
              </address>
            </>
          ) : (
            <p className="rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-muted">
              {t('contactMissing')}
            </p>
          )
        ) : null}

        {slug === 'confidentialite' ? <PrivacyRegister locale={locale} /> : null}

        {/* La même liste décide de cette mention ET de l'enregistrement d'une
            acceptation dans le tunnel de commande : on ne peut pas rédiger les
            conditions sans que la preuve commence à être constituée, ni
            l'inverse. Voir lib/config/pages.ts. */}
        {isPlaceholderPage(slug) ? (
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
