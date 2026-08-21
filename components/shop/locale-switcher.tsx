'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/lib/i18n/navigation'
import { locales, localeNames, type Locale } from '@/lib/i18n/routing'
import { Select } from '@/components/ui/select'

/**
 * Sélecteur de langue.
 *
 * Le choix vit dans l'URL, pas dans un cookie. Basculer en néerlandais mène à
 * `/nl/…`, et c'est cette adresse qui se retrouve dans l'historique, dans les
 * favoris et dans un lien partagé — donc le choix suit la personne partout où
 * il compte.
 *
 * Le cookie de langue a été retiré : posé sur simple lecture de l'en-tête du
 * navigateur, il déposait un identifiant de douze mois sans qu'aucun choix
 * n'ait été fait, et faisait basculer le site du côté des sites qui doivent
 * afficher un bandeau. Voir `lib/i18n/routing.ts` pour l'arbitrage complet.
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
