import 'server-only'

import { headers } from 'next/headers'
import { createHash } from 'node:crypto'

/**
 * Empreinte d'appelant pour la limitation de débit.
 *
 * Hachée : elle sert de clé de compteur, pas de trace. Aucune adresse IP en
 * clair ne doit se retrouver dans les logs ou dans Redis.
 */
export async function clientFingerprint(): Promise<string> {
  const h = await headers()

  // Sur Vercel, x-forwarded-for est renseigné par la plateforme ; le premier
  // segment est l'adresse cliente réelle.
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || h.get('x-real-ip') || 'inconnu'

  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}
