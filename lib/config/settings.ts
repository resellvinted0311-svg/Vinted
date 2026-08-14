import 'server-only'

import { z } from 'zod'
import { prisma } from '@/lib/db/client'

/**
 * Lecture des réglages métier stockés en base.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi aucune valeur de repli
 * ---------------------------------------------------------------------------
 * Le brief est explicite : « ne code aucun coefficient en dur ». Un accesseur
 * qui renverrait une valeur par défaut quand la clé manque contournerait cette
 * règle en douceur — le code compilerait, tournerait, et facturerait selon un
 * chiffre que personne n'a choisi.
 *
 * Une clé absente ou mal typée lève donc. Mieux vaut un déploiement qui refuse
 * de démarrer qu'une boutique qui applique une majoration inventée.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi une lecture groupée
 * ---------------------------------------------------------------------------
 * Le calcul d'un devis de port a besoin de deux réglages, le checkout de cinq.
 * Les lire un par un multiplierait les allers-retours — coûteux derrière un
 * pooler, et surtout deux lectures séparées peuvent tomber de part et d'autre
 * d'une modification en back-office et produire un calcul incohérent.
 */

/** Erreur de configuration : la boutique ne peut pas fonctionner sans. */
export class MissingSettingError extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`Réglage « ${key} » ${reason}. Renseignez-le dans la table Setting.`)
    this.name = 'MissingSettingError'
  }
}

const positiveInt = z.number().int().positive()
const nonNegativeInt = z.number().int().nonnegative()

/**
 * Réglages connus et leur forme attendue.
 *
 * Déclarés ici plutôt qu'au point d'appel : la forme d'un réglage est une
 * propriété du réglage, pas de celui qui le lit. Deux appelants ne peuvent donc
 * pas en attendre deux types différents.
 */
const SCHEMAS = {
  packagingWeightGrams: nonNegativeInt,
  shippingMarkupPercent: nonNegativeInt,
  reservationTtlMinutes: positiveInt,
  minMarginCents: nonNegativeInt,
  contributionRateBps: nonNegativeInt,
  stripePercentBps: nonNegativeInt,
  stripeFixedCents: nonNegativeInt,
  cgvVersion: z.string().min(1),
  withdrawalPeriodDays: positiveInt,
  returnShippingPaidByCustomer: z.boolean(),
  refundOutboundShippingOnWithdrawal: z.boolean(),
} as const

export type SettingKey = keyof typeof SCHEMAS
export type SettingValue<K extends SettingKey> = z.infer<(typeof SCHEMAS)[K]>

/** Lit plusieurs réglages en une requête, tous validés. */
export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  })

  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  const result = {} as { [P in K]: SettingValue<P> }

  for (const key of keys) {
    if (!byKey.has(key)) {
      throw new MissingSettingError(key, 'est absent de la base')
    }

    const parsed = SCHEMAS[key].safeParse(byKey.get(key))
    if (!parsed.success) {
      // Le message ne cite jamais la valeur : un réglage peut être sensible,
      // et de toute façon c'est la forme attendue qui aide à corriger.
      throw new MissingSettingError(
        key,
        `n'a pas la forme attendue (${parsed.error.issues[0]?.message ?? 'invalide'})`,
      )
    }

    result[key] = parsed.data as SettingValue<K>
  }

  return result
}

/** Lit un réglage isolé. Préférer `getSettings` dès qu'il y en a deux. */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValue<K>> {
  const values = await getSettings([key])
  return values[key]
}

/** Configuration du calcul de port, telle que l'attend `lib/domain/shipping`. */
export async function getShippingConfig(): Promise<{
  packagingWeightGrams: number
  shippingMarkupPercent: number
}> {
  return getSettings(['packagingWeightGrams', 'shippingMarkupPercent'])
}
