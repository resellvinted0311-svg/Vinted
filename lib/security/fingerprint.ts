import 'server-only'

import { headers } from 'next/headers'
import { pseudonymize } from './pseudonymize'

/**
 * Empreinte d'appelant pour la limitation de débit.
 *
 * Le haché sans clé qui figurait ici n'anonymisait rien : les 4 milliards
 * d'adresses IPv4 se pré-calculent, donc `sha256(ip)` se retourne en adresse
 * en clair. Or cette empreinte part chez un tiers (Upstash) dans le chemin
 * d'URL des requêtes, où elle est susceptible d'être journalisée.
 *
 * On passe donc par un HMAC à rotation quotidienne : le jeton reste stable le
 * temps d'une fenêtre de comptage, mais il n'est ni réversible ni corrélable
 * d'un jour à l'autre. Voir `pseudonymize.ts` pour le détail du raisonnement.
 */
export async function clientFingerprint(): Promise<string> {
  const h = await headers()

  // Sur Vercel, x-forwarded-for est renseigné par la plateforme ; le premier
  // segment est l'adresse cliente réelle.
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || h.get('x-real-ip') || 'inconnu'

  return pseudonymize({ purpose: 'rate-limit:ip', value: ip, rotateDaily: true })
}
