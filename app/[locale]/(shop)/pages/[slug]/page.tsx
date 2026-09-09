import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LEGAL, SITE, hasLegalIdentity, hasMediator } from '@/lib/config/site'
import {
  isPlaceholderPage,
  isPageSlug,
  PAGE_SLUGS,
  type PageSlug,
} from '@/lib/config/pages'
import { locales, localeTags } from '@/lib/i18n/routing'
import { descriptionCourte } from '@/lib/seo/metadata'
import { PrivacyRegister } from '@/components/shop/privacy-register'
import { getSettings } from '@/lib/config/settings'
import { getShippingGrids } from '@/lib/db/queries/shipping'
import { formatPrice } from '@/lib/utils/format'

/**
 * Pages éditoriales et légales.
 *
 * La page de confidentialité fait exception : elle est rendue depuis le
 * registre des traitements (`lib/config/privacy.ts`), donc elle est exacte dès
 * maintenant — le site collecte des adresses e-mail aujourd'hui, il doit dire
 * aujourd'hui ce qu'il en fait. Les CGV, la page cookies et la page livraison
 * ont depuis été écrites, et la page de livraison suit le même principe : son
 * barème est LU dans la base, pas recopié.
 *
 * Règle tenue dès maintenant : aucune mention légale n'est inventée. Tant que
 * l'identité de l'entreprise n'est pas renseignée en variables
 * d'environnement, la page l'annonce clairement au lieu d'afficher un texte
 * plausible — un faux SIRET est pire que pas de SIRET.
 */

type Params = Promise<{ locale: string; slug: string }>

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    PAGE_SLUGS.map((slug) => ({ locale, slug })),
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

/**
 * La phrase qui DÉCRIT chaque page fixe, prise dans son propre texte.
 *
 * Ces huit pages n'avaient aucune description : elles héritaient donc de celle
 * de la mise en page — la baseline du site, cinq mots, à l'identique sur
 * toutes. Huit pages qui se présentent pareil sont huit pages que le moteur
 * traite comme interchangeables.
 *
 * Aucune de ces phrases n'est écrite ici : chacune est la première ligne que
 * la page affiche déjà, dans la langue affichée. C'est délibéré, et c'est ce
 * qui les garde exactes — une description rédigée à part cesse de dire la
 * vérité le jour où la page change, sans que rien ne le signale. Seules les
 * mentions légales font exception : leur contenu est un tableau d'identité,
 * pas une phrase, donc il n'y a rien à réutiliser.
 *
 * Le nom du fichier de messages est porté avec la clé : ces textes vivent dans
 * quatre espaces de noms différents, et un chemin en dur ici pointerait vers
 * la mauvaise racine.
 */
const DESCRIPTION_KEY: Record<PageSlug, { namespace: string; key: string }> = {
  'mentions-legales': { namespace: 'seo', key: 'legalNotice' },
  cgv: { namespace: 'legal', key: 'terms.intro' },
  confidentialite: { namespace: 'privacy', key: 'intro' },
  cookies: { namespace: 'legal', key: 'cookies.intro' },
  livraison: { namespace: 'legal', key: 'shipping.intro' },
  retours: { namespace: 'footer', key: 'withdrawalNotice' },
  contact: { namespace: 'footer', key: 'contactIntro' },
  'a-propos': { namespace: 'home', key: 'intro' },
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

  const { namespace, key } = DESCRIPTION_KEY[slug]
  const tDescription = await getTranslations({ locale, namespace })

  return {
    title: t(TITLE_KEY[slug]),
    description: descriptionCourte(tDescription(key)),
    alternates: { canonical: `/${locale}/pages/${slug}`, languages },
  }
}

/**
 * Le barème de livraison, mis à plat pour l'affichage.
 *
 * Les zones et les tarifs sont deux tables : un tarif porte un code de zone,
 * pas son nom. On les rapproche ici plutôt que dans le rendu, pour que la page
 * n'ait qu'à parcourir une liste — et pour que l'ordre d'affichage soit celui,
 * délibéré, de la position des zones, et non celui où la base les a rendues.
 */
async function lireLeBareme() {
  const { zones, rates } = await getShippingGrids()

  const parCode = new Map(zones.map((zone) => [zone.code, zone]))

  return rates
    .map((rate, index) => {
      const zone = parCode.get(rate.zoneCode)
      return {
        // Un tarif n'a pas d'identifiant dans la grille de domaine : la clé de
        // rendu se compose de ce qui le distingue vraiment.
        id: `${rate.zoneCode}-${rate.serviceCode}-${rate.maxWeightGrams}-${index}`,
        zoneName: zone?.name ?? rate.zoneCode,
        zonePosition: zone?.position ?? Number.MAX_SAFE_INTEGER,
        freeFrom: zone?.freeShippingThresholdCents ?? null,
        label: rate.label,
        maxWeightGrams: rate.maxWeightGrams,
        priceCents: rate.priceCents,
        deliveryDaysMin: rate.deliveryDaysMin,
        deliveryDaysMax: rate.deliveryDaysMax,
      }
    })
    .sort(
      (a, b) =>
        a.zonePosition - b.zonePosition ||
        a.maxWeightGrams - b.maxWeightGrams ||
        a.priceCents - b.priceCents,
    )
}

/**
 * Les sections des conditions générales, dans l'ordre où elles se lisent.
 *
 * La liste est ici et non dans les messages : c'est une structure, pas un
 * texte, et elle doit être la même dans les huit langues. Une traduction qui
 * oublierait une section la ferait disparaître de cette langue-là seulement.
 */
const SECTIONS_CGV = [
  'scope',
  'seller',
  'pieces',
  'prices',
  'offers',
  'order',
  'payment',
  'delivery',
  'withdrawal',
  'warranty',
  'claims',
  'data',
  'law',
] as const

export default async function StaticPage({ params }: { params: Params }) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  if (!isPageSlug(slug)) notFound()

  const t = await getTranslations('footer')
  const th = await getTranslations('home')
  const tl = await getTranslations('legal')

  /*
    Les deux lectures ci-dessous sont CONDITIONNÉES au slug rendu.

    Ces pages sont prérendues une par langue, soit soixante-quatre rendus : y
    lire les réglages et le barème sans condition, ce serait cent
    vingt-huit requêtes de build pour deux pages qui en ont besoin. Le prérendu
    a déjà échoué une fois sur un manque de connexions à la base, et c'est
    exactement de cette façon que le nombre de requêtes enfle sans qu'on le
    remarque.
  */
  const reglages =
    slug === 'cgv'
      ? await getSettings([
          'cgvVersion',
          'offerResponseHours',
          'acceptedOfferValidityHours',
          'reservationTtlMinutes',
        ])
      : null

  const tarifs = slug === 'livraison' ? await lireLeBareme() : []

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

        {slug === 'cgv' ? (
          hasLegalIdentity() ? (
            <>
              {/*
                La VERSION affichée est celle que le tunnel enregistre.

                Elle vient du même réglage, lu au même endroit. Deux sources
                auraient divergé au premier changement de texte, et la preuve
                aurait alors désigné une version que personne n'a jamais pu
                lire — exactement le défaut qu'on a passé du temps à fermer.
              */}
              <p className="text-xs text-muted" data-numeric>
                {tl('terms.version', { version: reglages?.cgvVersion ?? '' })}
              </p>

              <p>{tl('terms.intro')}</p>

              {SECTIONS_CGV.map((cle) => (
                <section key={cle} className="mt-4 flex flex-col gap-2">
                  <h2 className="text-lg">{tl(`terms.${cle}Title`)}</h2>
                  <p className="text-muted">
                    {tl(`terms.${cle}Body`, {
                      response: reglages?.offerResponseHours ?? 0,
                      validity: reglages?.acceptedOfferValidityHours ?? 0,
                      reservation: reglages?.reservationTtlMinutes ?? 0,
                    })}
                  </p>
                </section>
              ))}
            </>
          ) : (
            /*
              Le même refus que sur les mentions légales, pour une raison plus
              lourde encore : des conditions de vente sans vendeur identifié
              n'engagent personne, et les afficher laisserait croire le
              contraire à l'acheteur comme à la boutique.
            */
            <p className="rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-muted">
              Les conditions générales sont rédigées, mais elles ne sont pas
              publiées tant que l’identité de l’entreprise n’est pas renseignée
              (LEGAL_COMPANY_NAME, LEGAL_SIRET, LEGAL_ADDRESS, LEGAL_EMAIL) : un
              contrat de vente désigne un vendeur. Aucune acceptation n’est
              enregistrée d’ici là.
            </p>
          )
        ) : null}

        {slug === 'cookies' ? (
          <>
            <p>{tl('cookies.intro')}</p>

            {/*
              Un tableau, et non une liste de paragraphes : trois témoins,
              trois colonnes identiques, c'est un tableau. Il défile
              horizontalement dans son propre cadre plutôt que d'élargir la
              page sur un téléphone.
            */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="border-b border-sand pb-2 pr-4 font-normal">
                      {tl('cookies.tableName')}
                    </th>
                    <th className="border-b border-sand pb-2 pr-4 font-normal">
                      {tl('cookies.tableRole')}
                    </th>
                    <th className="border-b border-sand pb-2 font-normal">
                      {tl('cookies.tableLife')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(['session', 'auth', 'locale'] as const).map((cle) => (
                    <tr key={cle} className="align-top">
                      <td className="border-b border-sand py-3 pr-4">
                        {tl(`cookies.${cle}Name`)}
                      </td>
                      <td className="border-b border-sand py-3 pr-4 text-muted">
                        {tl(`cookies.${cle}Role`)}
                      </td>
                      <td className="border-b border-sand py-3 text-muted">
                        {tl(`cookies.${cle}Life`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mt-6 text-lg">{tl('cookies.manageTitle')}</h2>
            <p className="text-muted">{tl('cookies.manageBody')}</p>
          </>
        ) : null}

        {slug === 'livraison' ? (
          <>
            <p>{tl('shipping.intro')}</p>

            {/*
              Le barème est LU dans la base, jamais recopié.

              Une page de livraison écrite à la main se désynchronise du
              premier changement de tarif, et le défaut est invisible : la page
              reste jolie, elle annonce simplement un prix que le panier ne
              pratique plus. Ici, les deux ne peuvent pas diverger — c'est la
              même table.
            */}
            {tarifs.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="border-b border-sand pb-2 pr-4 font-normal">
                        {tl('shipping.tableZone')}
                      </th>
                      <th className="border-b border-sand pb-2 pr-4 font-normal">
                        {tl('shipping.tableService')}
                      </th>
                      <th className="border-b border-sand pb-2 pr-4 font-normal">
                        {tl('shipping.tableWeight')}
                      </th>
                      <th className="border-b border-sand pb-2 pr-4 font-normal">
                        {tl('shipping.tablePrice')}
                      </th>
                      <th className="border-b border-sand pb-2 font-normal">
                        {tl('shipping.tableDelay')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tarifs.map((tarif) => (
                      <tr key={tarif.id} className="align-top">
                        <td className="border-b border-sand py-3 pr-4">
                          {tarif.zoneName}
                          {tarif.freeFrom !== null ? (
                            <>
                              <br />
                              <span className="text-xs text-success">
                                {tl('shipping.freeFrom', {
                                  amount: formatPrice(tarif.freeFrom, locale),
                                })}
                              </span>
                            </>
                          ) : null}
                        </td>
                        <td className="border-b border-sand py-3 pr-4 text-muted">
                          {tarif.label}
                        </td>
                        <td
                          className="border-b border-sand py-3 pr-4 text-muted"
                          data-numeric
                        >
                          {(tarif.maxWeightGrams / 1000).toLocaleString(locale)}
                          &nbsp;kg
                        </td>
                        <td
                          className="border-b border-sand py-3 pr-4"
                          data-numeric
                        >
                          {formatPrice(tarif.priceCents, locale)}
                        </td>
                        <td className="border-b border-sand py-3 text-muted">
                          {tl('shipping.days', {
                            min: tarif.deliveryDaysMin,
                            max: tarif.deliveryDaysMax,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-card border-[1.5px] border-warning bg-paper-raised p-4 text-muted">
                {tl('shipping.emptyGrid')}
              </p>
            )}

            <h2 className="mt-6 text-lg">{tl('shipping.dispatchTitle')}</h2>
            <p className="text-muted">{tl('shipping.dispatchBody')}</p>

            <h2 className="mt-6 text-lg">{tl('shipping.problemTitle')}</h2>
            <p className="text-muted">{tl('shipping.problemBody')}</p>
          </>
        ) : null}

        {slug === 'confidentialite' ? (
          <PrivacyRegister locale={locale} />
        ) : null}

        {/*
          Le garde-fou reste, et sa liste est vide.

          Il affiche cet avertissement sur toute page annoncée mais pas encore
          écrite. Les trois qui l'étaient ne le sont plus, donc il ne rend rien
          aujourd'hui — et c'est exactement ce qu'on veut d'un garde-fou. Le
          retirer reviendrait à parier qu'aucune page ne sera plus jamais mise
          en ligne avant son texte ; le pari a déjà été perdu une fois, avec
          une preuve d'acceptation constituée contre un document inexistant.

          La même liste décide de cette mention ET de l'horodatage d'une
          acceptation dans le tunnel : on ne peut pas publier un texte sans que
          les preuves commencent, ni l'inverse. Voir lib/config/pages.ts.
        */}
        {isPlaceholderPage(slug) ? (
          <p className="rounded-card ruled bg-paper-raised p-4 text-muted">
            Cette page est annoncée dans la navigation mais son texte n’est pas
            encore écrit. Sa structure, son adresse et ses liens sont en place
            dès maintenant pour que le référencement ne change plus ensuite.
          </p>
        ) : null}
      </div>

      <p className="mt-10 text-xs text-muted">{SITE.name}</p>
    </article>
  )
}
