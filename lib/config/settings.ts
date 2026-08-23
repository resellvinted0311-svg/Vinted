import 'server-only'

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import type { PricingConfig } from '@/lib/domain/pricing'

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
 *
 * ---------------------------------------------------------------------------
 * Pourquoi ces fonctions acceptent un client de transaction
 * ---------------------------------------------------------------------------
 * Appelées depuis l'intérieur d'une transaction interactive, elles DOIVENT
 * utiliser la connexion de cette transaction. Le client global en demanderait
 * une seconde au pool — or la connexion applicative est réglée à UNE seule en
 * production (`connection_limit=1`, recommandation de Prisma derrière un
 * pooler). La transaction tient l'unique connexion, la lecture attend une
 * connexion qui ne se libérera qu'à la fin de la transaction : interblocage,
 * jusqu'au délai d'attente du pool.
 *
 * Ce défaut ne se voit pas en développement, où la limite n'est pas posée.
 * D'où le paramètre, plutôt qu'une discipline à retenir.
 */

/** Client Prisma ou client de transaction : les deux savent lire. */
type Reader = Prisma.TransactionClient | typeof prisma

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
  /**
   * Délai entre la publication d'une pièce et l'ouverture des offres.
   *
   * Une pièce négociable dès la première heure ne se vend jamais au prix
   * affiché : il suffit d'attendre. Le délai laisse au prix demandé le temps
   * d'exister.
   */
  offersOpenAfterDays: nonNegativeInt,
  minMarginCents: nonNegativeInt,
  contributionRateBps: nonNegativeInt,
  stripePercentBps: nonNegativeInt,
  stripeFixedCents: nonNegativeInt,
  /**
   * Zone d'expédition qui sert de RÉFÉRENCE au calcul du prix plancher.
   *
   * Le plancher intègre le port, parce qu'au-dessus du seuil de livraison
   * offerte c'est le vendeur qui le supporte. Encore faut-il savoir quel port :
   * la même pièce coûte 4,20 € à expédier en France et 42,00 € en outre-mer.
   *
   * Retenir la zone la moins chère fabriquerait un plancher optimiste, donc
   * des ventes déficitaires ; retenir la plus chère fabriquerait un plancher
   * inatteignable. On retient la zone où la boutique vend RÉELLEMENT le plus,
   * et c'est un réglage, pas une constante écrite dans le code.
   */
  floorShippingZoneCode: z.string().min(1).max(32),
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
  client: Reader = prisma,
): Promise<{ [P in K]: SettingValue<P> }> {
  const rows = await client.setting.findMany({
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
  client: Reader = prisma,
): Promise<SettingValue<K>> {
  const values = await getSettings([key], client)
  return values[key]
}

/** Configuration du calcul de port, telle que l'attend `lib/domain/shipping`. */
export async function getShippingConfig(client: Reader = prisma): Promise<{
  packagingWeightGrams: number
  shippingMarkupPercent: number
}> {
  return getSettings(['packagingWeightGrams', 'shippingMarkupPercent'], client)
}

/**
 * Configuration des calculs de prix, telle que l'attend `lib/domain/pricing`.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi cet accesseur a fini par manquer
 * ---------------------------------------------------------------------------
 * `lib/domain/pricing.ts` accepte une configuration PAR DÉFAUT. Pratique pour
 * les tests, mais tant que personne ne lisait ces quatre réglages, chaque
 * calcul retombait sur les valeurs écrites dans le code — et les lignes
 * `minMarginCents`, `contributionRateBps`, `stripePercentBps` et
 * `stripeFixedCents` de la table `Setting` étaient purement décoratives.
 *
 * Le brief l'interdit en toutes lettres : « ne code aucun coefficient en dur ».
 * Le taux de cotisation d'une micro-entreprise change par arrêté, et la
 * commission d'un prestataire de paiement change par contrat ; les deux
 * doivent se corriger en back-office, sans redéploiement.
 */
export async function getPricingConfig(
  client: Reader = prisma,
): Promise<PricingConfig> {
  return getSettings(
    [
      'minMarginCents',
      'contributionRateBps',
      'stripePercentBps',
      'stripeFixedCents',
    ],
    client,
  )
}
