import 'server-only'

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import type { OfferPolicy } from '@/lib/domain/offers'
import type { AutoDropStage, PricingConfig } from '@/lib/domain/pricing'

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

/**
 * Erreur de configuration : la boutique ne peut pas fonctionner sans.
 *
 * ---------------------------------------------------------------------------
 * Elle nomme TOUS les réglages fautifs, pas le premier
 * ---------------------------------------------------------------------------
 * La version d'avant s'arrêtait au premier manquant. Sur une base plus ancienne
 * que le code, il en manque rarement un seul : on corrigeait, on relançait, on
 * découvrait le suivant, et ainsi de suite — un aller-retour par ligne absente,
 * chacun coûtant un import complet pour l'apprendre.
 *
 * `keys` est donc un tableau, et le message les énumère.
 */
export class MissingSettingError extends Error {
  readonly keys: readonly string[]

  constructor(keys: string | readonly string[], reason: string) {
    const list = typeof keys === 'string' ? [keys] : [...keys]
    const named = list.map((key) => `« ${key} »`).join(', ')
    const plural = list.length > 1 ? 'Réglages' : 'Réglage'

    super(`${plural} ${named} ${reason}. Renseignez-les dans « Réglages ».`)
    this.name = 'MissingSettingError'
    this.keys = list
  }

  /** Le premier fautif. Conservé : des appelants n'en attendent qu'un. */
  get key(): string {
    return this.keys[0] ?? ''
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
  /** Temps laissé au vendeur pour répondre à une offre. */
  offerResponseHours: positiveInt,
  /** Durée pendant laquelle un prix accepté reste payable. */
  acceptedOfferValidityHours: positiveInt,
  /** Plancher ABSOLU d'une offre, toutes pièces confondues. */
  minOfferAmountCents: nonNegativeInt,
  /** Combien d'offres une même personne peut déposer sur une même pièce. */
  maxOffersPerArticlePerUser: positiveInt,
  /**
   * Délai de carence après un refus.
   *
   * Sans lui, un refus se contourne en renvoyant la même offre à un centime
   * près, indéfiniment.
   */
  offerCooldownAfterRejectionHours: nonNegativeInt,
  /**
   * L'acceptation automatique des offres.
   *
   * DÉSACTIVÉE par défaut, et le brief l'exige : si les acheteurs découvrent
   * qu'une offre basse passe toute seule, le prix affiché devient décoratif.
   */
  autoAcceptOffersEnabled: z.boolean(),
  /**
   * Pourcentage du prix affiché à partir duquel une offre passerait seule.
   *
   * Nullable, et nul par défaut : un seuil absent vaut acceptation automatique
   * inerte, ce qui est le comportement voulu tant que personne n'a tranché.
   * Le prix plancher reste de toute façon infranchissable par une machine —
   * voir `lib/domain/offers.ts`.
   */
  autoAcceptThresholdPercent: positiveInt.max(100).nullable(),
  /**
   * Barème de la baisse automatique : paliers d'ancienneté et remises.
   *
   * Chaque pourcentage s'applique au prix d'ORIGINE (voir `AutoDropStage`,
   * lib/domain/pricing.ts). Borné à 99 : à 100, le « prix » n'en serait plus
   * un, et le plancher écrêterait de toute façon.
   *
   * Un tableau VIDE désactive la baisse — même motif que le seuil
   * d'acceptation automatique : la désactivation est une valeur explicite,
   * consignée en base, jamais l'absence d'une clé (qui, elle, lève).
   */
  autoDropSchedule: z
    .array(
      z
        .object({
          days: positiveInt,
          percent: positiveInt.max(99),
        })
        .strict(),
    )
    .max(12)
    .refine(
      (stages) => new Set(stages.map((stage) => stage.days)).size === stages.length,
      { message: 'deux paliers portent la même ancienneté' },
    )
    .refine(
      (stages) =>
        [...stages]
          .sort((a, b) => a.days - b.days)
          .every(
            (stage, index, sorted) =>
              index === 0 || stage.percent > (sorted[index - 1]?.percent ?? 0),
          ),
      // Le palier dû est le plus ANCIEN atteint : avec une remise qui
      // décroît, une pièce de soixante-dix jours serait moins remisée qu'une
      // pièce de quarante-cinq — les plus vieilles pièces vendues plus cher
      // que les jeunes. Un barème pareil est une faute de saisie, pas une
      // intention : on le refuse à la lecture.
      { message: 'les remises doivent croître avec l’ancienneté' },
    ),
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

  /**
   * Le grand visuel paysage de la page d'accueil.
   *
   * -------------------------------------------------------------------------
   * Pourquoi un réglage et pas une constante
   * -------------------------------------------------------------------------
   * C'est un choix éditorial qui changera au rythme des saisons de chine, pas
   * une propriété du code. Le poser en réglage, c'est pouvoir le remplacer
   * depuis la régie, sans redéploiement — et pouvoir ouvrir la boutique
   * AUJOURD'HUI, sans photographie, l'emplacement restant vide jusqu'à ce
   * qu'une adresse soit saisie.
   *
   * -------------------------------------------------------------------------
   * Pourquoi l'adresse est contrainte, et pas seulement « une URL »
   * -------------------------------------------------------------------------
   * `next/image` n'optimise QUE les hôtes déclarés dans `next.config.ts`, et
   * cette déclaration est restreinte au compte Cloudinary de la boutique. Une
   * adresse acceptée ici mais refusée là-bas ne produirait pas d'erreur
   * visible : le composant répondrait 400, la page d'accueil s'afficherait
   * avec un trou, et la régie afficherait le réglage comme correctement
   * enregistré. Le contrôle est donc posé à l'ÉCRITURE, là où quelqu'un peut
   * encore comprendre ce qu'on lui refuse.
   *
   * `null` est une valeur, pas une absence : c'est « pas encore de
   * photographie », et c'est l'état normal au lancement.
   */
  homeHeroImageUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine(
      (value) => {
        let url: URL
        try {
          url = new URL(value)
        } catch {
          return false
        }
        if (url.protocol !== 'https:') return false
        if (url.hostname !== 'res.cloudinary.com') return false
        return url.pathname.includes('/image/upload/')
      },
      {
        message:
          'l’adresse doit être une image Cloudinary de la boutique (https://res.cloudinary.com/…/image/upload/…)',
      },
    )
    .nullable(),
  cgvVersion: z.string().min(1),
  withdrawalPeriodDays: positiveInt,
  returnShippingPaidByCustomer: z.boolean(),
  refundOutboundShippingOnWithdrawal: z.boolean(),
  /**
   * D'où viennent les valeurs présentes en base.
   *
   * -------------------------------------------------------------------------
   * Le défaut que ce marqueur empêche
   * -------------------------------------------------------------------------
   * Le seed doit poser des nombres pour que la boutique tourne en
   * développement. Ces nombres sont FICTIFS et le disent — mais rien ne les
   * empêchait d'arriver en production : `npx prisma db seed` sur la mauvaise
   * base, une restauration, un premier déploiement où personne n'a rien saisi.
   *
   * La boutique se serait alors ouverte avec une marge cible et des coûts
   * transporteur inventés. Elle n'aurait rien affiché d'anormal : elle aurait
   * simplement vendu à perte, pièce après pièce, jusqu'à ce que quelqu'un fasse
   * les comptes.
   *
   * Le seed écrit donc `development`, le back-office écrit `production`, et le
   * calcul de prix REFUSE de servir en production tant que le marqueur n'a pas
   * changé. Voir `getPricingConfig`.
   */
  settingsProfile: z.enum(['development', 'production']),
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

  // On parcourt TOUT avant de lever : voir `MissingSettingError`. Corriger
  // ligne par ligne, en redécouvrant la suivante à chaque essai, est ce que
  // cette boucle évite.
  const absent: K[] = []
  const malformed: string[] = []

  for (const key of keys) {
    if (!byKey.has(key)) {
      absent.push(key)
      continue
    }

    const parsed = SCHEMAS[key].safeParse(byKey.get(key))
    if (!parsed.success) {
      // Le message ne cite jamais la valeur : un réglage peut être sensible,
      // et de toute façon c'est la forme attendue qui aide à corriger.
      malformed.push(
        `${key} (${parsed.error.issues[0]?.message ?? 'invalide'})`,
      )
      continue
    }

    result[key] = parsed.data as SettingValue<K>
  }

  // L'absence d'abord : une ligne à créer et une ligne à corriger ne se
  // réparent pas au même endroit, et l'absence est de loin la plus fréquente
  // sur une base déployée avant que le réglage n'existe.
  if (absent.length > 0) {
    throw new MissingSettingError(absent, 'est absent de la base')
  }

  if (malformed.length > 0) {
    throw new MissingSettingError(malformed, 'n’a pas la forme attendue')
  }

  return result
}

/**
 * Les réglages ABSENTS de la base, parmi tous ceux que le code connaît.
 *
 * Sert à l'écran de réglages, qui doit pouvoir dire « il manque ceci » au lieu
 * d'afficher un champ vide. Un champ vide et un champ dont la ligne n'existe
 * pas se ressemblent à l'écran, et n'ont rien à voir : le second fait refuser
 * l'enregistrement ENTIER, y compris les valeurs qu'on venait de saisir.
 *
 * Ne lève pas : c'est un diagnostic, et il doit rester lisible précisément
 * quand la configuration est en défaut.
 */
/**
 * Le visuel de la vitrine, ou rien — sans jamais lever.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi CE réglage se lit autrement que tous les autres
 * ---------------------------------------------------------------------------
 * `getSettings` lève quand une ligne manque, et c'est la bonne règle pour les
 * réglages qui décident d'un PRIX : mieux vaut une page en erreur qu'une marge
 * inventée. Ici la règle s'inverse. Le réglage vient d'être créé, la ligne
 * n'existe donc dans aucune base déployée — « une migration crée des tables,
 * jamais des lignes » — et une lecture qui lève ferait tomber LA PAGE
 * D'ACCUEIL, en huit langues, pour dire qu'il n'y a pas encore de photo.
 *
 * L'absence est justement l'état attendu au lancement. Elle se lit donc comme
 * `null`, c'est-à-dire « emplacement vide », qui est exactement ce que la
 * vitrine sait afficher.
 *
 * Une valeur MAL FORMÉE est traitée pareil, et pour la même raison : une
 * adresse qui ne passe plus la validation — l'hôte Cloudinary a changé, la
 * ligne a été éditée à la main — ne doit pas casser la vitrine. Elle est
 * ignorée, la page s'affiche sans image, et la régie la refusera à la
 * prochaine tentative d'enregistrement en expliquant pourquoi.
 */
export async function getHomeHeroImageUrl(
  client: Reader = prisma,
): Promise<string | null> {
  const row = await client.setting.findUnique({
    where: { key: 'homeHeroImageUrl' },
    select: { value: true },
  })

  if (!row) return null

  const parsed = SCHEMAS.homeHeroImageUrl.safeParse(row.value)
  return parsed.success ? parsed.data : null
}

/**
 * Réglages dont l'ABSENCE est un état normal, et non une configuration
 * incomplète.
 *
 * La bannière « lignes absentes » de la régie sert à expliquer pourquoi la
 * boutique refuse de calculer un prix. Y faire figurer un réglage qui n'est
 * pas censé être rempli au lancement — l'image de la vitrine — apprendrait à
 * la lire comme du bruit, et le jour où elle signalera une vraie ligne
 * manquante, personne ne la lira plus.
 */
const OPTIONAL_SETTINGS: readonly SettingKey[] = ['homeHeroImageUrl']

export async function findMissingSettings(
  client: Reader = prisma,
): Promise<SettingKey[]> {
  const keys = Object.keys(SCHEMAS) as SettingKey[]

  const rows = await client.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  })

  const present = new Set(rows.map((row) => row.key))
  const optional = new Set<SettingKey>(OPTIONAL_SETTINGS)
  return keys.filter((key) => !present.has(key) && !optional.has(key))
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/**
 * Comment un réglage se saisit à l'écran.
 *
 * Le type de champ est une propriété du RÉGLAGE, pas du formulaire — au même
 * titre que sa forme Zod. Le mettre ici évite qu'un écran affiche en euros ce
 * que la base stocke en centimes, ou l'inverse : l'erreur ne se verrait pas,
 * elle multiplierait les prix par cent.
 */
export type SettingFieldKind =
  | 'integer'
  | 'cents'
  | 'percent'
  | 'basisPoints'
  | 'boolean'
  | 'nullablePercent'
  | 'dropSchedule'
  /**
   * Un code de zone d'expédition, choisi dans une liste CONSTRUITE À PARTIR DE
   * LA BASE — jamais saisi librement. Voir `floorShippingZoneCode`.
   */
  | 'zoneCode'
  /**
   * Une adresse d'image, ou rien.
   *
   * Le champ vide vaut `null` et non chaîne vide : « pas de photographie » est
   * un état, et une chaîne vide passerait la validation d'URL en la faisant
   * échouer pour la mauvaise raison.
   */
  | 'imageUrl'

export interface EditableSetting {
  key: SettingKey
  kind: SettingFieldKind
  group: 'economy' | 'shipping' | 'drop' | 'offers' | 'checkout' | 'content'
}

/**
 * Les réglages que le back-office peut changer.
 *
 * ---------------------------------------------------------------------------
 * Une liste FERMÉE, et c'est le point
 * ---------------------------------------------------------------------------
 * Le formulaire n'écrit que ce qui figure ici. Sans cette liste, une action
 * serveur qui accepterait « une clé et une valeur » laisserait n'importe quel
 * administrateur — ou n'importe qui ayant volé sa session — réécrire
 * `cgvVersion` ou `withdrawalPeriodDays`, c'est-à-dire modifier ce que la
 * boutique affirme juridiquement à ses clientes.
 *
 * Sont donc EXCLUS, délibérément :
 *
 *  - `withdrawalPeriodDays`, `returnShippingPaidByCustomer`,
 *    `refundOutboundShippingOnWithdrawal` : conditions légales. Elles se
 *    changent avec un juriste, pas dans un formulaire entre deux commandes ;
 *  - `cgvVersion` : une version de CGV se change en publiant de nouvelles CGV ;
 *  - `impactCoefficients` : tant qu'aucune source vérifiée ne les fournit, le
 *    bloc reste masqué. Un formulaire inviterait à les inventer ;
 *  - `settingsProfile` : il n'est pas un réglage mais une conséquence — il
 *    passe à `production` du seul fait qu'on a enregistré ce formulaire.
 */
export const EDITABLE_SETTINGS: readonly EditableSetting[] = [
  // Ce que la boutique gagne. Le groupe le plus sensible : c'est lui qui a
  // motivé la sortie de ces nombres du dépôt.
  { key: 'minMarginCents', kind: 'cents', group: 'economy' },
  { key: 'contributionRateBps', kind: 'basisPoints', group: 'economy' },
  { key: 'stripePercentBps', kind: 'basisPoints', group: 'economy' },
  { key: 'stripeFixedCents', kind: 'cents', group: 'economy' },

  { key: 'shippingMarkupPercent', kind: 'percent', group: 'shipping' },
  { key: 'packagingWeightGrams', kind: 'integer', group: 'shipping' },

  /**
   * Éditable depuis qu'il se choisit dans une LISTE, et pas avant.
   *
   * -------------------------------------------------------------------------
   * Ce qui a changé, et pourquoi ça change la réponse
   * -------------------------------------------------------------------------
   * Il était exclu pour une raison juste : un champ de saisie libre y aurait
   * écrit une zone inexistante, et le calcul du plancher serait tombé sur
   * toutes les pièces à la fois. L'objection portait sur le CHAMP, pas sur le
   * réglage.
   *
   * Le champ est maintenant une liste construite à partir des zones réellement
   * présentes en base, et l'action revérifie le code choisi contre la base
   * avant d'écrire — la liste vient du serveur, mais un formulaire s'envoie
   * sans passer par la page qui l'a rendu.
   *
   * Ce que son exclusion coûtait, et qui a été payé : sa ligne manquait en
   * production, aucun écran ne pouvait la créer, et la boutique refusait donc
   * de calculer un prix — sans aucun moyen d'en sortir par l'interface. Un
   * réglage OBLIGATOIRE qu'aucun écran ne peut renseigner est un cul-de-sac,
   * pas une protection.
   */
  { key: 'floorShippingZoneCode', kind: 'zoneCode', group: 'shipping' },

  { key: 'autoDropSchedule', kind: 'dropSchedule', group: 'drop' },

  { key: 'offersOpenAfterDays', kind: 'integer', group: 'offers' },
  { key: 'offerResponseHours', kind: 'integer', group: 'offers' },
  { key: 'acceptedOfferValidityHours', kind: 'integer', group: 'offers' },
  { key: 'minOfferAmountCents', kind: 'cents', group: 'offers' },
  { key: 'maxOffersPerArticlePerUser', kind: 'integer', group: 'offers' },
  { key: 'offerCooldownAfterRejectionHours', kind: 'integer', group: 'offers' },
  { key: 'autoAcceptOffersEnabled', kind: 'boolean', group: 'offers' },
  { key: 'autoAcceptThresholdPercent', kind: 'nullablePercent', group: 'offers' },

  { key: 'reservationTtlMinutes', kind: 'integer', group: 'checkout' },

  /**
   * Éditable, et sans risque : c'est le seul réglage de la liste qui ne touche
   * ni à l'argent, ni au stock, ni à un engagement juridique. Le pire qu'une
   * mauvaise saisie puisse produire est une page d'accueil sans photographie —
   * exactement l'état de départ.
   */
  { key: 'homeHeroImageUrl', kind: 'imageUrl', group: 'content' },
] as const

const EDITABLE_BY_KEY = new Map(
  EDITABLE_SETTINGS.map((setting) => [setting.key, setting] as const),
)

export function isEditableSetting(key: string): key is SettingKey {
  return EDITABLE_BY_KEY.has(key as SettingKey)
}

export type SettingParse =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'not-editable' | 'malformed' }

/**
 * Transforme la saisie d'un formulaire en valeur stockable.
 *
 * ---------------------------------------------------------------------------
 * Cette fonction ne VALIDE pas, elle CONVERTIT
 * ---------------------------------------------------------------------------
 * Un formulaire HTML ne transporte que des chaînes. « 20 » doit devenir le
 * nombre 20, « oui » le booléen vrai, et deux lignes « 30:10 » un tableau
 * d'objets. La validation, elle, reste celle de `SCHEMAS` — appliquée ensuite
 * par `writeSettings`, et la même que celle de la lecture.
 *
 * Séparer les deux évite le défaut classique : un formulaire qui valide « à sa
 * façon » et laisse passer une valeur que la lecture refusera. Le réglage serait
 * alors écrit, et la boutique tomberait au prochain calcul de prix — sans que
 * l'écran qui l'a écrit ait rien signalé.
 */
export function parseSettingInput(key: string, raw: string): SettingParse {
  const setting = EDITABLE_BY_KEY.get(key as SettingKey)
  if (!setting) return { ok: false, reason: 'not-editable' }

  const trimmed = raw.trim()

  switch (setting.kind) {
    case 'boolean':
      // Une case décochée n'est PAS envoyée par le navigateur : l'absence vaut
      // faux. C'est le formulaire qui garantit la présence de la clé, par un
      // champ caché ; ici on interprète ce qui arrive.
      return { ok: true, value: trimmed === 'on' || trimmed === 'true' }

    case 'zoneCode': {
      // On vérifie ici la FORME, jamais l'existence : cette fonction est pure
      // et testable sans base. Que la zone existe se vérifie dans l'action, qui
      // a le client, juste avant d'écrire.
      if (trimmed === '') return { ok: false, reason: 'malformed' }
      if (trimmed.length > 32) return { ok: false, reason: 'malformed' }
      return { ok: true, value: trimmed }
    }

    case 'imageUrl': {
      // Vide = « pas encore de photographie », qui est l'état de lancement.
      // La FORME de l'adresse, elle, est vérifiée par le schéma Zod du
      // réglage : c'est lui qui exige l'hôte Cloudinary de la boutique, et
      // c'est lui qui produira le message d'erreur montré à la régie.
      if (trimmed === '') return { ok: true, value: null }
      return { ok: true, value: trimmed }
    }

    case 'nullablePercent': {
      // Vide = « aucun seuil », ce qui rend l'acceptation automatique inerte.
      // C'est une valeur, pas une omission : voir le commentaire du réglage.
      if (trimmed === '') return { ok: true, value: null }
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed)) return { ok: false, reason: 'malformed' }
      return { ok: true, value: parsed }
    }

    case 'dropSchedule': {
      // Un palier par ligne, « jours:pourcentage ». Une grille éditable en
      // texte plutôt qu'en champs répétés : le barème compte deux ou trois
      // paliers, et une zone de texte se corrige d'un coup.
      if (trimmed === '') return { ok: true, value: [] }

      const stages: { days: number; percent: number }[] = []
      for (const line of trimmed.split('\n')) {
        const clean = line.trim()
        if (clean === '') continue

        const [left, right, ...rest] = clean.split(':')
        if (rest.length > 0 || left === undefined || right === undefined) {
          return { ok: false, reason: 'malformed' }
        }

        const days = Number(left.trim())
        const percent = Number(right.trim())
        if (!Number.isInteger(days) || !Number.isInteger(percent)) {
          return { ok: false, reason: 'malformed' }
        }

        stages.push({ days, percent })
      }

      // Trié à l'écriture : `SCHEMAS.autoDropSchedule` exige des remises
      // croissantes avec l'ancienneté, mais dans l'ordre où elles arrivent.
      // Trier ici évite de refuser un barème correct saisi à l'envers.
      stages.sort((a, b) => a.days - b.days)
      return { ok: true, value: stages }
    }

    default: {
      if (trimmed === '') return { ok: false, reason: 'malformed' }
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed)) return { ok: false, reason: 'malformed' }
      return { ok: true, value: parsed }
    }
  }
}

export type WriteSettingsResult =
  | { ok: true; changed: SettingKey[] }
  | { ok: false; key: string; reason: 'not-editable' | 'invalid' }

/**
 * L'unique chemin d'écriture des réglages.
 *
 * ---------------------------------------------------------------------------
 * Validé avec le MÊME schéma que la lecture
 * ---------------------------------------------------------------------------
 * `getSettings` refuse une valeur mal formée en levant. Si l'écriture validait
 * autrement — ou pas du tout — on pourrait enregistrer un réglage que plus
 * personne ne sait relire : la boutique s'ouvrirait, puis tomberait au premier
 * calcul de prix, avec une erreur pointant la lecture alors que la faute est à
 * l'écriture.
 *
 * ---------------------------------------------------------------------------
 * Tout ou rien
 * ---------------------------------------------------------------------------
 * Le formulaire envoie une dizaine de réglages d'un coup. En écrire six puis
 * buter sur le septième laisserait une configuration MIXTE — une marge
 * minimale neuve avec une majoration de port ancienne — que personne n'a
 * choisie et que rien ne signalerait. On valide tout avant d'écrire quoi que
 * ce soit.
 */
export async function writeSettings(
  entries: ReadonlyArray<{ key: string; value: unknown }>,
  client: Reader = prisma,
): Promise<WriteSettingsResult> {
  const validated: { key: SettingKey; value: unknown }[] = []

  for (const entry of entries) {
    if (!isEditableSetting(entry.key)) {
      return { ok: false, key: entry.key, reason: 'not-editable' }
    }

    const parsed = SCHEMAS[entry.key].safeParse(entry.value)
    if (!parsed.success) {
      return { ok: false, key: entry.key, reason: 'invalid' }
    }

    validated.push({ key: entry.key, value: parsed.data })
  }

  /**
   * `upsert`, et non `update`.
   *
   * -------------------------------------------------------------------------
   * Une migration crée des TABLES, jamais des LIGNES
   * -------------------------------------------------------------------------
   * Un réglage ajouté au code après la mise en service n'existe pas dans une
   * base déjà déployée : le seed qui l'y aurait mis ne tourne qu'à la demande,
   * et les migrations ne peuplent rien. `update` lève alors P2025, la
   * transaction entière est annulée, et AUCUN réglage n'est enregistré.
   *
   * C'est arrivé exactement ainsi en production : la base avait été semée avant
   * que `settingsProfile` n'existe. L'écran rendait une erreur, rien n'était
   * écrit, et la boutique restait bloquée sur ses chiffres de démonstration
   * sans qu'on puisse en sortir par l'interface prévue pour ça.
   *
   * Écrire une valeur validée dans une ligne absente n'est pas un cas
   * douteux — c'est le cas NORMAL d'une base plus ancienne que le code.
   */
  for (const entry of validated) {
    await client.setting.upsert({
      where: { key: entry.key },
      update: { value: entry.value as never },
      create: { key: entry.key, value: entry.value as never },
    })
  }

  return { ok: true, changed: validated.map((entry) => entry.key) }
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
/**
 * Les réglages SANS LESQUELS la boutique ne peut pas calculer un prix.
 *
 * Nommés dans une constante exportée, et non écrits à l'intérieur de la
 * fonction, pour qu'un test puisse vérifier l'invariant qui manquait : chacun
 * doit être renseignable depuis le back-office.
 *
 * Ce que son absence a coûté : `floorShippingZoneCode` était obligatoire pour
 * vendre et absent du formulaire. Sa ligne manquait en production, aucun écran
 * ne pouvait la créer, et la boutique refusait donc de calculer un prix sans
 * qu'aucun chemin ne mène à la réparation. Un réglage obligatoire que
 * l'interface ne peut pas poser est un cul-de-sac, et rien ne l'interdisait.
 */
export const PRICING_SETTING_KEYS = [
  'minMarginCents',
  'contributionRateBps',
  'stripePercentBps',
  'stripeFixedCents',
  'settingsProfile',
] as const satisfies readonly SettingKey[]

/** Réglages de négociation, tels que l'attend `lib/domain/offers`. */
export async function getOfferPolicy(
  client: Reader = prisma,
): Promise<OfferPolicy> {
  return getSettings(
    [
      'minOfferAmountCents',
      'maxOffersPerArticlePerUser',
      'offerCooldownAfterRejectionHours',
      'offerResponseHours',
      'acceptedOfferValidityHours',
      'autoAcceptOffersEnabled',
      'autoAcceptThresholdPercent',
    ],
    client,
  )
}

/**
 * Erreur de mise en service : la boutique tourne encore sur les nombres du seed.
 *
 * Séparée de `MissingSettingError` parce que le geste correctif n'est pas le
 * même : là, un réglage manque ; ici, ils sont tous présents — et tous faux.
 */
export class DemoSettingsInProductionError extends Error {
  constructor() {
    super(
      'Les réglages de prix sont encore ceux du jeu de démonstration. ' +
        'Renseignez-les dans Réglages avant d’ouvrir la boutique : les valeurs ' +
        'du seed sont fictives et vendraient à perte.',
    )
    this.name = 'DemoSettingsInProductionError'
  }
}

export async function getPricingConfig(
  client: Reader = prisma,
): Promise<PricingConfig> {
  const values = await getSettings(PRICING_SETTING_KEYS, client)

  // ---------------------------------------------------------------------------
  // Le garde-fou, et pourquoi il est ICI
  // ---------------------------------------------------------------------------
  // C'est le passage obligé de tout ce qui fabrique un prix : plancher de
  // négociation, import d'une pièce, baisse automatique. Le poser plus haut —
  // au démarrage, dans un script — laisserait passer le cas qui compte
  // vraiment : une base restaurée ou re-semée APRÈS la mise en service, sur
  // laquelle plus personne ne relance de vérification.
  //
  // On refuse plutôt que d'avertir. Un journal d'avertissement sur une boutique
  // qui vend est un journal que personne ne lit avant le prochain bilan.
  //
  // `VERCEL_ENV` plutôt que `NODE_ENV` : ce dernier vaut « production » dans les
  // déploiements de prévisualisation, où le jeu de démonstration est justement
  // ce qu'on veut.
  if (
    values.settingsProfile === 'development' &&
    process.env.VERCEL_ENV === 'production'
  ) {
    throw new DemoSettingsInProductionError()
  }

  return {
    minMarginCents: values.minMarginCents,
    contributionRateBps: values.contributionRateBps,
    stripePercentBps: values.stripePercentBps,
    stripeFixedCents: values.stripeFixedCents,
  }
}

/**
 * Barème de la baisse automatique, trié par ancienneté croissante.
 *
 * Le tri est refait ici plutôt que supposé : le réglage est un tableau JSON
 * édité en back-office, et l'ordre d'un document édité n'est pas un invariant.
 */
export async function getAutoDropSchedule(
  client: Reader = prisma,
): Promise<AutoDropStage[]> {
  const { autoDropSchedule } = await getSettings(['autoDropSchedule'], client)
  return [...autoDropSchedule].sort((a, b) => a.days - b.days)
}
