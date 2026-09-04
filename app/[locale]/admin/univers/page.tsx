import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { requireAdmin } from '@/lib/auth/session'
import { handleAdminAuthError } from '@/lib/auth/admin-guard'
import {
  listUnqualifiedArticles,
  listCategoriesWithUnqualified,
  countUnqualified,
} from '@/lib/db/queries/admin-audiences'
import { AudienceWorklist } from '@/components/admin/audience-worklist'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'admin' })
  return { title: t('audiences.title'), robots: { index: false, follow: false } }
}

/**
 * Ranger le registre en univers — Femme, Homme, Mixte.
 *
 * ---------------------------------------------------------------------------
 * Cet écran est ce qui manquait pour que la vitrine EXISTE
 * ---------------------------------------------------------------------------
 * Les deux cartes d'univers de l'accueil ne s'affichent qu'à partir de deux
 * univers fournis, et les grilles de sous-catégories se construisent sur les
 * facettes. Tant que `audience` est nulle partout, la vitrine demandée est
 * dans le code et invisible à l'écran — ce qui a été constaté en production.
 *
 * La colonne ne se remplit par aucun autre chemin : la synchronisation ne
 * l'écrit pas, et le formulaire de pièce ne s'ouvre que sur les pièces nées
 * ici. Le stock, lui, vient de l'application de gestion.
 *
 * ---------------------------------------------------------------------------
 * Le filtre par catégorie est ce qui rend le travail faisable
 * ---------------------------------------------------------------------------
 * Qualifier un millier de pièces une par une ne se fait pas. Filtrer sur
 * « Robes », tout cocher, cliquer « Femme » se fait en trois gestes — et les
 * catégories réellement mixtes, comme les pulls, se traitent ensuite pièce par
 * pièce sans être noyées dans le reste.
 *
 * C'est la boutiquière qui décide, toujours : aucune règle « robes donc femme »
 * n'est écrite dans le code. Une correspondance devinée serait fausse quelque
 * part, et fausse sans que personne ne la relise.
 */
export default async function AdminAudiencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ cat?: string; tout?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  try {
    await requireAdmin()
  } catch (error) {
    handleAdminAuthError(error, locale)
  }

  const t = await getTranslations('admin.audiences')
  const { cat, tout } = await searchParams

  // Un paramètre d'URL n'est pas une donnée de confiance : il est passé à une
  // clause `categoryId` typée, jamais concaténé. Une valeur inconnue ne rend
  // pas d'erreur — elle rend une liste vide, ce qui est le bon comportement.
  const categoryId = typeof cat === 'string' && cat !== '' ? cat : undefined
  const inclureHorsGrille = tout === '1'

  const [restant, categories, articles] = await Promise.all([
    countUnqualified(inclureHorsGrille),
    listCategoriesWithUnqualified(locale, inclureHorsGrille),
    listUnqualifiedArticles({ locale, categoryId, inclureHorsGrille }),
  ])

  const lien = (params: { cat?: string | undefined; tout?: boolean }) => {
    const query = new URLSearchParams()
    if (params.cat) query.set('cat', params.cat)
    if (params.tout ?? inclureHorsGrille) query.set('tout', '1')
    const suffixe = query.toString()
    return `/${locale}/admin/univers${suffixe === '' ? '' : `?${suffixe}`}`
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl">{t('title')}</h1>
        <p className="label-reg text-muted" data-numeric>
          {t('remaining', { count: restant })}
        </p>
      </div>

      <p className="mt-3 max-w-prose text-sm text-muted">{t('intro')}</p>

      {/*
        Dit une fois, en haut : sans cette phrase, quelqu'un qui trouve la
        vitrine vide cherchera un défaut d'affichage pendant une heure.
      */}
      <p className="mt-2 max-w-prose text-sm text-muted">{t('whyItMatters')}</p>

      <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2" aria-label={t('filterLabel')}>
        <FilterLink href={lien({})} active={categoryId === undefined}>
          {t('allCategories')}
        </FilterLink>
        {categories.map((category) => (
          <FilterLink
            key={category.id}
            href={lien({ cat: category.id })}
            active={categoryId === category.id}
          >
            {category.name} <span data-numeric>({category.count})</span>
          </FilterLink>
        ))}
      </nav>

      <p className="mt-4 text-xs text-muted">
        <Link
          href={lien({ cat: categoryId, tout: !inclureHorsGrille })}
          className="underline-offset-4 hover:underline"
        >
          {inclureHorsGrille ? t('onlyListed') : t('includeUnlisted')}
        </Link>
      </p>

      {articles.length === 0 ? (
        <div className="mt-8 rounded-card ruled bg-surface p-8">
          <p className="text-base text-ink">{t('empty')}</p>
          <p className="mt-1 text-xs text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <AudienceWorklist articles={articles} />
      )}
    </div>
  )
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      // `aria-current` et pas seulement une couleur : le filtre actif doit se
      // savoir autrement qu'à l'œil.
      aria-current={active ? 'true' : undefined}
      className={
        active
          ? 'label-reg text-ink underline underline-offset-4'
          : 'label-reg text-muted underline-offset-4 hover:text-ink hover:underline'
      }
    >
      {children}
    </Link>
  )
}
