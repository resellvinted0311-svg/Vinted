'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/lib/i18n/navigation'
import { locales, localeNames, type Locale } from '@/lib/i18n/routing'
import { Select } from '@/components/ui/select'

/**
 * Sélecteur de langue.
 *
 * Le choix est persisté par next-intl dans le cookie ND_LOCALE : une personne
 * qui bascule en néerlandais reste en néerlandais à la visite suivante, même
 * si son navigateur annonce autre chose.
 */
export function LocaleSwitcher() {
  const locale = useLocale()
  const t = useTranslations('nav')
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const options = locales.map((code) => ({
    value: code,
    label: localeNames[code],
  }))

  return (
    <Select
      options={options}
      value={locale}
      ariaLabel={t('language')}
      disabled={isPending}
      onValueChange={(next) => {
        startTransition(() => {
          // `pathname` est déjà dépourvu du préfixe de langue et porte les
          // segments résolus : la bascule conserve donc l'article ou la
          // catégorie affichée.
          router.replace(pathname, { locale: next as Locale })
        })
      }}
      // Compact : le sélecteur partage la ligne de titre avec la recherche et
      // le compte. À 9rem il poussait « Se connecter » à la ligne suivante.
      className="w-[7.5rem] shrink-0 px-2.5"
    />
  )
}
