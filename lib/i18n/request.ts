import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing, localeTags, type Locale } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale: Locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  const messages = (await import(`../../messages/${locale}.json`)).default

  return {
    locale,
    messages,
    // Fuseau figé : les compteurs de fin d'offre et les dates de commande
    // doivent être identiques pour l'acheteuse ou l'acheteur et pour le
    // back-office, quelle que soit la localisation du navigateur.
    timeZone: 'Europe/Paris',
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'long', year: 'numeric' },
        withTime: {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
      number: {
        price: {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      },
    },
    // Utilisé par Intl pour les pluriels et les formats régionaux.
    now: undefined,
    onError(error) {
      // Une clé manquante ne doit jamais casser une page publique ; elle doit
      // en revanche être bruyante en développement.
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[i18n] ${error.message}`)
      }
    },
    getMessageFallback({ key, namespace }) {
      return namespace ? `${namespace}.${key}` : key
    },
  }
})

export { localeTags }
